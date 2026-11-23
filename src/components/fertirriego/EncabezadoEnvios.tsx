'use client'

/**
 * Barra de arriba de las pantallas de Campo (Fertirriego, Inyección, Motores): «Regresar», el estado de la conexión
 * como en WhatsApp («En línea» / «Sin señal»), cuántos registros esperan señal y cuántos tienen error. Al tocar el
 * estado se abre el panel «Envíos» con el detalle de cada error y qué hacer. Sin sondeos: usa lo que ya sabe `useCampo`.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { formatearFechaHora } from '@/lib/estados'
import type { useCampo } from '@/lib/fertirriego/useCampo'
import { useNavegadorEnLinea } from '@/lib/fertirriego/useEstadoConexion'
import type { Operacion } from '@/lib/fertirriego/tipos'
import { VistaEnvios } from './VistaEnvios'

export function EncabezadoEnvios({
  campo,
  volverHref = '/campo',
  volverTexto = 'Regresar',
  onActualizar,
  actualizando,
  onCorregir,
}: {
  campo: ReturnType<typeof useCampo>
  volverHref?: string
  volverTexto?: string
  /** Además de sincronizar, qué más actualizar (p. ej. los motores). */
  onActualizar?: () => void
  actualizando?: boolean
  onCorregir?: (o: Operacion) => void
}) {
  const navegador = useNavegadorEnLinea()
  const enLinea = campo.conexion === 'en_linea' && navegador
  const pendientes = campo.cola.filter((o) => o.estado_local === 'PENDIENTE').length
  const rechazados = campo.cola.filter((o) => o.estado_local === 'RECHAZADO').length
  const [abierto, setAbierto] = useState(false)

  // Llegar desde el menú de Campo con «Envíos» ya abierto
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('envios') === '1') setAbierto(true)
  }, [])

  const ocupado = campo.sincronizando || Boolean(actualizando)
  const color = rechazados > 0 ? 'bg-red-50 text-red-800 ring-red-600/30' : enLinea ? 'bg-brand-50 text-brand-800 ring-brand-600/20' : 'bg-slate-100 text-slate-700 ring-slate-400/30'

  return (
    <>
      <div className="sticky top-0 z-30 -mx-1 flex flex-wrap items-center justify-between gap-2 bg-white/95 px-1 backdrop-blur" data-encabezado-envios>
        <Link href={volverHref} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-bold text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600" data-regresar>
          <span aria-hidden="true">←</span> {volverTexto}
        </Link>
        <button
          type="button"
          onClick={() => setAbierto(true)}
          data-barra-estado={campo.conexion}
          data-abrir-envios
          aria-label={`Estado de envíos: ${enLinea ? 'en línea' : 'sin señal'}${pendientes ? `, ${pendientes} por enviar` : ''}${rechazados ? `, ${rechazados} con error` : ''}. Toca para ver el detalle.`}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${color}`}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${enLinea ? 'bg-brand-600' : 'bg-slate-500'}`} />
          {enLinea ? 'En línea' : 'Sin señal'}
          {pendientes > 0 && <span data-pendientes-cuenta className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">{pendientes} por enviar</span>}
          {rechazados > 0 && <span data-errores-cuenta className="rounded-full bg-red-600 px-2 py-0.5 text-white">{rechazados} con error</span>}
          {pendientes === 0 && rechazados === 0 && <span className="font-semibold text-slate-500">todo enviado</span>}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{enLinea ? '' : 'Sin señal: lo que registres se guarda en el teléfono y se envía solo.'}</span>
        <span className="flex items-center gap-2">
          {campo.sincronizadoEn && <span>Actualizado {formatearFechaHora(campo.sincronizadoEn)}</span>}
          <button
            type="button"
            onClick={() => {
              void campo.sincronizarAhora()
              onActualizar?.()
            }}
            disabled={ocupado}
            className="min-h-11 font-bold text-slate-700 underline disabled:no-underline disabled:opacity-60"
            data-actualizar
          >
            {ocupado ? 'Actualizando…' : 'Actualizar'}
          </button>
        </span>
      </div>

      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Envíos">
        <div data-panel-envios>
          <VistaEnvios
            estado={campo.estado}
            cola={campo.cola}
            enLinea={enLinea}
            sincronizando={campo.sincronizando}
            onSincronizar={() => void campo.sincronizarAhora()}
            onDescartar={(id) => void campo.descartarConConstancia(id)}
            onReintentar={(id) => void campo.reintentar(id)}
            onAyuda={(id) => campo.pedirAyuda(id)}
            onCorregir={
              onCorregir
                ? (o) => {
                    setAbierto(false)
                    onCorregir(o)
                  }
                : undefined
            }
          />
          <button type="button" onClick={() => setAbierto(false)} className="mt-4 min-h-11 w-full rounded-xl border border-slate-300 text-sm font-bold text-slate-700" data-cerrar-envios>
            Regresar
          </button>
        </div>
      </Modal>
    </>
  )
}
