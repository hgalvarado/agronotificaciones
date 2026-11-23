'use client'

/**
 * Panel «Envíos» (lo que espera señal y lo que la base no aceptó, con qué hacer en cada caso). Se abre desde el
 * indicador «En línea / Sin señal» del encabezado global (evento `campo:abrir-envios`) o llegando con `?envios=1`.
 * Quien lo atiende cancela el evento (`preventDefault`): así el indicador sabe que ya hay un panel y no navega.
 */

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { EVENTO_ABRIR_ENVIOS } from '@/lib/campo/eventos'
import type { useCampo } from '@/lib/fertirriego/useCampo'
import { useNavegadorEnLinea } from '@/lib/fertirriego/useEstadoConexion'
import type { Operacion } from '@/lib/fertirriego/tipos'
import { VistaEnvios } from './VistaEnvios'

export function PanelEnvios({
  campo,
  onCorregir,
  abrirAlMontar = false,
}: {
  campo: ReturnType<typeof useCampo>
  onCorregir?: (o: Operacion) => void
  /** Abierto desde el primer cuadro (cuando el panel se montó justo porque la persona tocó el indicador). */
  abrirAlMontar?: boolean
}) {
  const navegador = useNavegadorEnLinea()
  const enLinea = campo.conexion === 'en_linea' && navegador
  const [abierto, setAbierto] = useState(abrirAlMontar)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('envios') === '1') setAbierto(true)
    const alPedir = (e: Event) => {
      e.preventDefault() // «ya hay un panel aquí»: el indicador no tiene que navegar
      setAbierto(true)
    }
    window.addEventListener(EVENTO_ABRIR_ENVIOS, alPedir)
    return () => window.removeEventListener(EVENTO_ABRIR_ENVIOS, alPedir)
  }, [])

  return (
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
  )
}
