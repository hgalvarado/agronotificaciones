'use client'

/**
 * Aviso flotante (tipo notificación): aparece abajo, encima de la barra de Guardar, dura unos segundos y se va solo.
 * No tapa el trabajo ni pide nada; se lee aunque la persona esté al final del formulario (en el teléfono, el aviso de
 * arriba no se veía). Uso: const { aviso, mostrar } = useAvisoFlotante(); …; <AvisoFlotante aviso={aviso} />
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type Aviso = { texto: string; tono: 'exito' | 'error' | 'info'; n: number }

export function useAvisoFlotante(duracion = 3500) {
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mostrar = useCallback((texto: string, tono: Aviso['tono'] = 'exito') => {
    if (reloj.current) clearTimeout(reloj.current)
    setAviso({ texto, tono, n: Date.now() })
    reloj.current = setTimeout(() => setAviso(null), tono === 'error' ? duracion * 2 : duracion)
  }, [duracion])
  useEffect(() => () => { if (reloj.current) clearTimeout(reloj.current) }, [])
  return { aviso, mostrar, cerrar: () => setAviso(null) }
}

const TONOS = {
  exito: 'bg-brand-700 text-white',
  error: 'bg-red-600 text-white',
  info: 'bg-slate-800 text-white',
}

export function AvisoFlotante({ aviso, abajo = 'bottom-24' }: { aviso: Aviso | null; abajo?: string }) {
  return (
    <div aria-live="polite" role="status" className={`pointer-events-none fixed inset-x-0 ${abajo} z-40 flex justify-center px-4`}>
      {aviso && (
        <div key={aviso.n} data-aviso-flotante
          className={`anim-aparecer pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${TONOS[aviso.tono]}`}>
          {aviso.tono === 'exito' ? '✓ ' : ''}{aviso.texto}
        </div>
      )}
    </div>
  )
}
