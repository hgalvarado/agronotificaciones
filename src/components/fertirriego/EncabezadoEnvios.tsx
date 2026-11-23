'use client'

/**
 * Barra de arriba de las pantallas de Campo (Fertirriego, Inyección, Motores): «Regresar» al menú de Campo y
 * «Actualizar». El estado de la conexión («En línea» / «Sin señal», lo que espera señal y los errores) ya NO vive aquí:
 * está en el encabezado de toda la app (`IndicadorConexion`, como WhatsApp) y, al tocarlo, abre el panel «Envíos»
 * (`PanelEnvios`, montado aquí porque esta pantalla es la que sabe corregir cada envío).
 */

import Link from 'next/link'
import { formatearFechaHora } from '@/lib/estados'
import type { useCampo } from '@/lib/fertirriego/useCampo'
import { useNavegadorEnLinea } from '@/lib/fertirriego/useEstadoConexion'
import type { Operacion } from '@/lib/fertirriego/tipos'
import { PanelEnvios } from './PanelEnvios'

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
  const ocupado = campo.sincronizando || Boolean(actualizando)

  return (
    <>
      <div className="flex items-center justify-between gap-2" data-encabezado-envios>
        <Link href={volverHref} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-bold text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600" data-regresar>
          <span aria-hidden="true">←</span> {volverTexto}
        </Link>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          {campo.sincronizadoEn && <span className="hidden sm:inline">Actualizado {formatearFechaHora(campo.sincronizadoEn)}</span>}
          <button
            type="button"
            onClick={() => {
              void campo.sincronizarAhora()
              onActualizar?.()
            }}
            disabled={ocupado}
            className="min-h-11 px-1 font-bold text-slate-700 underline disabled:no-underline disabled:opacity-60"
            data-actualizar
          >
            {ocupado ? 'Actualizando…' : 'Actualizar'}
          </button>
        </span>
      </div>
      {!enLinea && <p className="text-xs text-slate-500">Sin señal: lo que registres se guarda en el teléfono y se envía solo.</p>}
      <PanelEnvios campo={campo} onCorregir={onCorregir} />
    </>
  )
}
