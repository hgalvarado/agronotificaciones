'use client'

/**
 * El código de relevo de quien ENTREGA: 6 dígitos que cambian cada 30 s, calculados en el teléfono con su llave
 * (sin internet). Se muestra grande para que el compañero lo escriba en su propio teléfono.
 */

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton } from '@/components/ui/Primitivos'
import { codigoEn, pasoDe, segundosRestantes, type LlavePersona } from '@/lib/fertirriego/codigo'

export function PantallaCodigo({
  llave,
  estacion,
  onCerrar,
  onCancelarEntrega,
}: {
  llave: LlavePersona | null
  estacion: string
  onCerrar: () => void
  onCancelarEntrega?: () => void
}) {
  const [codigo, setCodigo] = useState<string | null>(null)
  const [restan, setRestan] = useState(segundosRestantes())

  useEffect(() => {
    if (!llave) return
    let vivo = true
    let paso = -1
    const tic = async () => {
      const ahora = Date.now()
      setRestan(segundosRestantes(ahora))
      if (pasoDe(ahora) !== paso) {
        paso = pasoDe(ahora)
        const c = await codigoEn(llave.llave, paso)
        if (vivo) setCodigo(c)
      }
    }
    void tic()
    const reloj = setInterval(() => void tic(), 1000)
    return () => {
      vivo = false
      clearInterval(reloj)
    }
  }, [llave])

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`Código de entrega · ${estacion}`}
      pie={
        <div className="flex gap-2">
          {onCancelarEntrega && (
            <Boton variante="secundario" className="flex-1" onClick={onCancelarEntrega} data-cancelar-entrega>
              Cancelar la entrega
            </Boton>
          )}
          <Boton className="flex-1" onClick={onCerrar}>
            Listo
          </Boton>
        </div>
      }
    >
      {!llave ? (
        <Alerta tono="ambar">
          Este teléfono todavía no tiene tu llave de relevo. Ábrelo una vez con señal (después funciona sin señal) o pide a tu compañero que te
          reciba iniciando sesión en este teléfono.
        </Alerta>
      ) : (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <p className="text-sm text-slate-600">Que tu compañero escriba este código en SU teléfono, en «Recibir estación»:</p>
          <p className="font-mono text-5xl font-bold tracking-[0.3em] text-slate-900" data-codigo-relevo={codigo ?? ''} aria-live="polite">
            {codigo ? `${codigo.slice(0, 3)} ${codigo.slice(3)}` : '··· ···'}
          </p>
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${(restan / 30) * 100}%` }} />
          </div>
          <p className="text-xs text-slate-500">Cambia en {restan} s. Funciona sin señal.</p>
        </div>
      )}
    </Modal>
  )
}
