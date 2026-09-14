'use client'

/**
 * El botón «Exportar para SAP».
 *
 * Existe aparte del Excel normal a propósito, y por eso son dos botones y
 * no un desplegable: el Excel completo es para revisar y el de SAP es para
 * cargar en el sistema. Tienen columnas distintas y confundirlos cuesta
 * una notificación rechazada.
 *
 * No sabe qué columnas lleva ninguna de las dos hojas: recibe una función
 * que se las da ya armadas. Así el formato vive en `lib/sap/exportacion`,
 * donde se puede probar sin navegador.
 */

import { useState } from 'react'
import { Boton } from './Primitivos'
import { IconSend } from './Icons'
import { construirXlsx, descargar, type CeldaHoja } from '@/lib/hojas'

export function BotonExportarSap({
  nombreArchivo,
  hoja,
  filas,
  deshabilitado = false,
}: {
  nombreArchivo: string
  /** Nombre de la pestaña dentro del libro. */
  hoja: string
  /** Se llama al pulsar, no antes: armar la hoja de miles de filas en
   *  cada render dejaría la tabla pegada. */
  filas: () => CeldaHoja[][]
  deshabilitado?: boolean
}) {
  const [ocupado, setOcupado] = useState(false)

  function exportar() {
    setOcupado(true)
    try {
      descargar(construirXlsx(hoja, filas()), `${nombreArchivo}.xlsx`)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Boton variante="suave" tamano="sm" onClick={exportar} disabled={deshabilitado || ocupado}>
      <IconSend className="h-4 w-4" />
      Exportar para SAP
    </Boton>
  )
}
