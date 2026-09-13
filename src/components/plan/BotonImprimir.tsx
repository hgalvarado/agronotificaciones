'use client'

import { Boton } from '@/components/ui/Primitivos'
import { IconSend } from '@/components/ui/Icons'

/**
 * Imprime el reporte. En el diálogo de impresión de Chrome/Edge se elige
 * «Guardar como PDF» y queda el archivo listo para adjuntar al correo,
 * que es exactamente lo que él hace hoy a mano desde Excel.
 */
export function BotonImprimir() {
  return (
    <Boton onClick={() => window.print()}>
      <IconSend className="h-4 w-4" />
      Imprimir o guardar PDF
    </Boton>
  )
}
