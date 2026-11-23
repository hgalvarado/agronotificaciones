'use client'

/**
 * El panel «Envíos» para quien llega desde una pantalla que NO es de Campo (Tickets, Horómetros…): el indicador del
 * encabezado lo lleva a `/campo?envios=1`. Aquí solo se monta la lógica de Campo (`useCampo`: lee la cola del teléfono y
 * sincroniza) cuando de verdad se pide el panel; abrir el menú de Campo sin tocarlo no consulta nada.
 */

import { useEffect, useState } from 'react'
import { PanelEnvios } from '@/components/fertirriego/PanelEnvios'
import { EVENTO_ABRIR_ENVIOS } from '@/lib/campo/eventos'
import { useCampo } from '@/lib/fertirriego/useCampo'

function ConLogica({ usuarioId }: { usuarioId: string }) {
  const campo = useCampo(usuarioId)
  return <PanelEnvios campo={campo} abrirAlMontar />
}

export function PanelEnviosCampo({ usuarioId }: { usuarioId: string }) {
  const [pedido, setPedido] = useState(false)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('envios') === '1') setPedido(true)
    const alPedir = (e: Event) => {
      e.preventDefault()
      setPedido(true)
    }
    window.addEventListener(EVENTO_ABRIR_ENVIOS, alPedir)
    return () => window.removeEventListener(EVENTO_ABRIR_ENVIOS, alPedir)
  }, [])
  return pedido ? <ConLogica usuarioId={usuarioId} /> : null
}
