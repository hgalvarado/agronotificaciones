'use client'

/**
 * El código de relevo de quien ENTREGA: 6 dígitos que cambian cada 30 s, calculados en el teléfono con su llave
 * (sin internet). Se muestra grande para que el compañero lo escriba en su propio teléfono.
 */

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton } from '@/components/ui/Primitivos'
import { codigoEn, codigoLargoEn, pasoDe, pasoLargoDe, segundosRestantes, venceCodigoLargo, type LlavePersona } from '@/lib/fertirriego/codigo'
import { aEntradaLocal } from '@/lib/fechas/zona'

/** «13/11 a las 12:10» (hora de Honduras). */
function cuando(ms: number): string {
  const [f, h] = aEntradaLocal(new Date(ms).toISOString()).split('T')
  return `${f.slice(8, 10)}/${f.slice(5, 7)} a las ${h}`
}

/**
 * Relevo de noche (pedido del usuario tras la prueba piloto): quien entrega termina a medianoche y el compañero llega
 * cuando él ya duerme. Le deja un código de 8 dígitos que vale 12 horas (escrito en la estación o por WhatsApp).
 */
function CodigoLargo({ llave, estacion }: { llave: LlavePersona; estacion: string }) {
  const [codigo, setCodigo] = useState<{ valor: string; vence: number } | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  async function mostrar() {
    const ahora = Date.now()
    setCodigo({ valor: await codigoLargoEn(llave.llave, pasoLargoDe(ahora)), vence: venceCodigoLargo(ahora) })
  }

  if (!codigo) {
    return (
      <button type="button" onClick={() => void mostrar()} className="mt-2 text-sm font-semibold text-brand-700 underline" data-ver-codigo-largo>
        ¿Te vas antes de que llegue tu compañero? Ver código de 12 horas
      </button>
    )
  }
  const texto = `Código de entrega de ${estacion}: ${codigo.valor.slice(0, 4)} ${codigo.valor.slice(4)} (vale hasta el ${cuando(codigo.vence)}).`
  return (
    <div className="mt-3 w-full rounded-xl bg-amber-50 p-3 text-center ring-1 ring-inset ring-amber-200" data-codigo-largo={codigo.valor}>
      <p className="text-xs font-semibold text-amber-900">Código de entrega (vale 12 horas)</p>
      <p className="my-1 font-mono text-4xl font-bold tracking-[0.2em] text-slate-900">
        {codigo.valor.slice(0, 4)} {codigo.valor.slice(4)}
      </p>
      <p className="text-xs text-amber-900">
        Vale hasta el {cuando(codigo.vence)}. Déjalo escrito en la estación o mándalo por WhatsApp: tu compañero lo escribe en
        «Recibir estación», aunque no haya señal. No lo compartas con nadie más.
      </p>
      <Boton
        variante="secundario"
        className="mt-2"
        onClick={async () => {
          try {
            if (navigator.share) await navigator.share({ text: texto })
            else {
              await navigator.clipboard.writeText(texto)
              setAviso('Copiado. Pégalo en WhatsApp.')
            }
          } catch {
            /* el usuario cerró la ventana de compartir */
          }
        }}
        data-compartir-codigo-largo
      >
        Compartir
      </Boton>
      {aviso && <p className="mt-1 text-xs text-slate-600">{aviso}</p>}
    </div>
  )
}

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
          <CodigoLargo llave={llave} estacion={estacion} />
        </div>
      )}
    </Modal>
  )
}
