'use client'

/**
 * «Envíos»: lo que está guardado en el teléfono esperando señal, lo que la base rechazó (con el motivo, para
 * corregirlo) y lo que llegó con observaciones (marcas para revisar). Nada se borra solo si fue rechazado: la
 * persona lo ve y decide.
 */

import { Alerta, Boton, Insignia } from '@/components/ui/Primitivos'
import { formatearFechaHora } from '@/lib/estados'
import { NOMBRE_OBSERVACION } from '@/lib/fertirriego/operaciones'
import type { EstadoCampo, Operacion } from '@/lib/fertirriego/tipos'

const NOMBRE_TIPO: Record<string, string> = {
  recepcion: 'Recepción',
  aplicacion: 'Aplicación',
  bitacora: 'Bitácora de riego',
  conteo: 'Conteo',
  devolucion: 'Devolución',
  anulacion: 'Anulación',
  chofer: 'Chofer nuevo',
  vehiculo: 'Vehículo nuevo',
}

export function VistaEnvios({
  estado,
  cola,
  enLinea,
  sincronizando,
  onSincronizar,
  onDescartar,
}: {
  estado: EstadoCampo | null
  cola: Operacion[]
  enLinea: boolean
  sincronizando: boolean
  onSincronizar: () => void
  onDescartar: (id: string) => void
}) {
  const pendientes = cola.filter((o) => o.estado_local === 'PENDIENTE')
  const rechazados = cola.filter((o) => o.estado_local === 'RECHAZADO')
  const observados = (estado?.mis_operaciones ?? []).filter((o) => o.resultado === 'ACEPTADO_CON_OBSERVACIONES').slice(0, 20)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {pendientes.length ? `${pendientes.length} registro(s) guardados en el teléfono, esperando señal.` : 'Todo lo registrado ya se envió.'}
        </p>
        <Boton tamano="sm" variante="secundario" onClick={onSincronizar} disabled={sincronizando} data-sincronizar>
          {sincronizando ? 'Enviando…' : enLinea ? 'Enviar ahora' : 'Reintentar'}
        </Boton>
      </div>

      {pendientes.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-inset ring-slate-200" data-pendientes>
          {pendientes.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-800">{o.resumen}</span>
                <span className="text-[11px] text-slate-500">
                  {formatearFechaHora(o.creado_en)}
                  {o.intentos ? ` · ${o.intentos} intento(s)` : ''}
                </span>
              </span>
              <Insignia tono="ambar">por enviar</Insignia>
            </li>
          ))}
        </ul>
      )}

      {rechazados.length > 0 && (
        <div data-rechazados>
          <Alerta>
            {rechazados.length === 1 ? 'Un registro no se aceptó.' : `${rechazados.length} registros no se aceptaron.`} Revisa el motivo y vuelve a
            registrarlo bien; después quítalo de esta lista.
          </Alerta>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-inset ring-red-200">
            {rechazados.map((o) => (
              <li key={o.id} className="px-3 py-2">
                <p className="text-sm font-semibold text-slate-800">
                  {NOMBRE_TIPO[o.tipo] ?? o.tipo} · {formatearFechaHora(o.creado_en)}
                </p>
                <p className="text-xs text-red-700">{o.mensaje}</p>
                <button type="button" onClick={() => onDescartar(o.id)} className="mt-1 text-xs font-bold text-slate-600 underline" data-descartar>
                  Entendido, quitar de la lista
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {observados.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Llegaron con observaciones</p>
          <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-inset ring-slate-200" data-observados>
            {observados.map((o) => (
              <li key={o.id} className="px-3 py-2">
                <p className="text-sm font-semibold text-slate-800">
                  {NOMBRE_TIPO[o.tipo] ?? o.tipo} · {formatearFechaHora(o.recibido_en)}
                </p>
                <p className="text-xs text-amber-700">{(o.observaciones ?? []).map((x) => NOMBRE_OBSERVACION[x] ?? x).join(' · ')}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
