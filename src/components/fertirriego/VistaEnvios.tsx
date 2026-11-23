'use client'

/**
 * «Envíos»: lo que está guardado en el teléfono esperando señal, lo que la base rechazó y lo que llegó con
 * observaciones (marcas para revisar). Un rechazo NUNCA deja el registro «guindado»: cada uno explica qué pasó, por qué
 * y qué hacer, y ofrece botones (Reintentar, Corregir y reenviar, Pedir ayuda al administrador, Descartar).
 */

import { useState } from 'react'
import { Alerta, Boton, Insignia } from '@/components/ui/Primitivos'
import { formatearFechaHora } from '@/lib/estados'
import { explicarEnvio } from '@/lib/fertirriego/errorEnvio'
import { NOMBRE_OBSERVACION, observacionesVisibles } from '@/lib/fertirriego/operaciones'
import type { EstadoCampo, Operacion } from '@/lib/fertirriego/tipos'

export const NOMBRE_TIPO: Record<string, string> = {
  recepcion: 'Recepción',
  aplicacion: 'Aplicación',
  aplicacion_historica: 'Aplicación histórica (registro inicial)',
  bitacora: 'Bitácora de riego',
  conteo: 'Conteo',
  devolucion: 'Devolución',
  devolucion_bodega: 'Devolución a bodega',
  aplicacion_lote: 'Aplicación por lote',
  motor_asignar: 'Movimiento de motor',
  motor_retiro: 'Retiro de motor',
  motor_registro_diario: 'Registro diario del motor',
  motor_mantenimiento: 'Mantenimiento de motor',
  diesel_recibir: 'Diésel recibido',
  anulacion: 'Anulación',
  chofer: 'Chofer nuevo',
  vehiculo: 'Vehículo nuevo',
  relevo_entregar: 'Entrega de estación',
  relevo_recibir: 'Recepción de estación',
  relevo_cancelar: 'Cancelar entrega',
  relevo_rechazar: 'No recibir la estación',
  traslado_crear: 'Traslado',
  traslado_autorizar: 'Autorización de traslado',
  traslado_aceptar: 'Recepción de traslado',
  traslado_rechazar: 'Rechazo de traslado',
  traslado_cancelar: 'Cancelar traslado',
}

export function VistaEnvios({
  estado,
  cola,
  enLinea,
  sincronizando,
  onSincronizar,
  onDescartar,
  onReintentar,
  onAyuda,
  onCorregir,
}: {
  estado: EstadoCampo | null
  cola: Operacion[]
  enLinea: boolean
  sincronizando: boolean
  onSincronizar: () => void
  onDescartar: (id: string) => void
  onReintentar?: (id: string) => void
  /** Devuelve true si la base recibió el aviso (hace falta señal). */
  onAyuda?: (id: string) => Promise<boolean>
  /** Abre el formulario de ese tipo para volver a registrarlo bien. Si no se da, el botón no sale. */
  onCorregir?: (o: Operacion) => void
}) {
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [avisos, setAvisos] = useState<Record<string, string>>({})
  const pendientes = cola.filter((o) => o.estado_local === 'PENDIENTE')
  const rechazados = cola.filter((o) => o.estado_local === 'RECHAZADO')
  const observados = (estado?.mis_operaciones ?? []).filter((o) => o.resultado === 'ACEPTADO_CON_OBSERVACIONES').slice(0, 20)

  async function pedirAyuda(id: string) {
    const ok = onAyuda ? await onAyuda(id) : false
    setAvisos((a) => ({
      ...a,
      [id]: ok ? 'Listo: el administrador ya lo ve en su computadora.' : 'No hay señal para avisar. Inténtalo cuando tengas señal; el registro sigue guardado.',
    }))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {pendientes.length ? `${pendientes.length} registro(s) guardados en el teléfono, esperando señal.` : 'Todo lo registrado ya se envió.'}
        </p>
        <Boton tamano="sm" variante="secundario" onClick={onSincronizar} disabled={sincronizando} data-sincronizar className="min-h-11">
          {sincronizando ? 'Enviando…' : enLinea ? 'Enviar ahora' : 'Reintentar'}
        </Boton>
      </div>

      {pendientes.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-inset ring-slate-200" data-pendientes>
          {pendientes.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <span className="block break-words text-sm font-semibold text-slate-800">{o.resumen}</span>
                <span className="block break-words text-xs text-slate-500">
                  {formatearFechaHora(o.creado_en)}
                  {o.intentos ? ` · ${o.intentos} intento(s)` : ''}
                </span>
                {o.intentos >= 5 && (
                  <span className="mt-0.5 block break-words text-xs font-semibold text-amber-700">
                    Lleva varios intentos sin enviarse: toca «Enviar ahora» con buena señal o avisa al administrador.
                  </span>
                )}
              </span>
              <Insignia tono="ambar">por enviar</Insignia>
            </li>
          ))}
        </ul>
      )}

      {rechazados.length > 0 && (
        <div data-rechazados>
          <Alerta>
            {rechazados.length === 1 ? 'Un registro no se aceptó.' : `${rechazados.length} registros no se aceptaron.`} Abajo dice por qué y qué
            puedes hacer con cada uno. Ninguno se pierde ni se queda trabado.
          </Alerta>
          <ul className="mt-2 flex flex-col gap-2">
            {rechazados.map((o) => {
              const d = explicarEnvio({ mensaje: o.mensaje, tipo: o.tipo, observaciones: o.observaciones })
              const puedeCorregir = d.acciones.includes('corregir') && Boolean(onCorregir)
              return (
                <li key={o.id} className="rounded-xl bg-white px-3 py-3 ring-1 ring-inset ring-red-200" data-envio-rechazado={o.tipo}>
                  <p className="break-words text-sm font-bold text-slate-900">
                    {NOMBRE_TIPO[o.tipo] ?? o.tipo} · {formatearFechaHora(o.creado_en)}
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold text-red-800">{d.titulo}</p>
                  <dl className="mt-1 flex flex-col gap-1 text-xs text-slate-700">
                    <div>
                      <dt className="inline font-bold">Qué pasó: </dt>
                      <dd className="inline">{d.quePaso}</dd>
                    </div>
                    <div>
                      <dt className="inline font-bold">Por qué: </dt>
                      <dd className="inline">{d.porQue}</dd>
                    </div>
                    <div data-que-hacer>
                      <dt className="inline font-bold">Qué hacer: </dt>
                      <dd className="inline">{d.queHacer}</dd>
                    </div>
                    <div className="text-slate-500">
                      <dt className="inline font-bold">Mensaje del sistema: </dt>
                      <dd className="inline break-words">{o.mensaje}</dd>
                    </div>
                  </dl>
                  {o.ayuda_pedida && <p className="mt-1 text-xs font-semibold text-brand-700">Ya pediste ayuda: el administrador lo está viendo.</p>}
                  {avisos[o.id] && (
                    <p role="status" className="mt-1 text-xs font-semibold text-slate-700">
                      {avisos[o.id]}
                    </p>
                  )}

                  {confirmando === o.id ? (
                    <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-700" data-confirmar-descartar>
                      <p className="font-semibold">¿Descartar este registro? Se quita de tu teléfono y no se enviará. Queda anotado que lo descartaste.</p>
                      <div className="mt-2 flex gap-2">
                        <Boton
                          tamano="sm"
                          variante="peligro"
                          className="min-h-11 flex-1"
                          onClick={() => {
                            setConfirmando(null)
                            onDescartar(o.id)
                          }}
                          data-descartar-si
                        >
                          Descartar
                        </Boton>
                        <Boton tamano="sm" variante="secundario" className="min-h-11 flex-1" onClick={() => setConfirmando(null)}>
                          Regresar
                        </Boton>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {onReintentar && d.acciones.includes('reintentar') && (
                        <Boton tamano="sm" className="min-h-11" onClick={() => onReintentar(o.id)} data-reintentar>
                          Reintentar
                        </Boton>
                      )}
                      {puedeCorregir && (
                        <Boton tamano="sm" variante="secundario" className="min-h-11" onClick={() => onCorregir?.(o)} data-corregir>
                          Corregir y reenviar
                        </Boton>
                      )}
                      {onAyuda && !o.ayuda_pedida && (
                        <Boton tamano="sm" variante="secundario" className="min-h-11" onClick={() => void pedirAyuda(o.id)} data-pedir-ayuda>
                          Pedir ayuda al administrador
                        </Boton>
                      )}
                      <Boton tamano="sm" variante="secundario" className="min-h-11" onClick={() => setConfirmando(o.id)} data-descartar>
                        Descartar
                      </Boton>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {observados.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Llegaron con observaciones</p>
          <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-inset ring-slate-200" data-observados>
            {observados.map((o) => (
              <li key={o.id} className="px-3 py-2">
                <p className="text-sm font-semibold text-slate-800">
                  {NOMBRE_TIPO[o.tipo] ?? o.tipo} · {formatearFechaHora(o.recibido_en)}
                </p>
                <p className="text-xs text-amber-700">{observacionesVisibles(o.observaciones).map((x) => NOMBRE_OBSERVACION[x] ?? x).join(' · ')}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
