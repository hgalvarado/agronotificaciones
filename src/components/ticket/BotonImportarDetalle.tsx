'use client'

import { useState } from 'react'
import { Boton } from '@/components/ui/Primitivos'
import { IconCopy } from '@/components/ui/Icons'
import { ImportarDetalleTicket, type CatalogosTicket } from './ImportarDetalleTicket'

/**
 * El botón vive aparte del modal porque la página del ticket es de
 * servidor: sólo esta cáscara necesita ser de cliente.
 */
export function BotonImportarDetalle({
  ticketId,
  ticketCodigo,
  fechaTicket,
  catalogos,
}: {
  ticketId: string
  ticketCodigo: string
  fechaTicket: string
  catalogos: CatalogosTicket
}) {
  const [abierto, setAbrir] = useState(false)

  return (
    <>
      <Boton variante="suave" tamano="sm" onClick={() => setAbrir(true)}>
        <IconCopy className="h-4 w-4" />
        Cargar Excel
      </Boton>

      <ImportarDetalleTicket
        abierto={abierto}
        onCerrar={() => setAbrir(false)}
        ticketId={ticketId}
        ticketCodigo={ticketCodigo}
        fechaTicket={fechaTicket}
        catalogos={catalogos}
      />
    </>
  )
}
