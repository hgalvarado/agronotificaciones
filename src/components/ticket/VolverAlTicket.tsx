import { createClient } from '@/lib/supabase/server'
import { BotonLink, Alerta } from '@/components/ui/Primitivos'
import { IconChevronLeft, IconPlus } from '@/components/ui/Icons'

/**
 * Salida clara hacia el ticket: botón de 44 px con el texto completo «Volver al ticket TK-…».
 * Si no se conoce el código del ticket, lo pide aquí (una consulta pequeña).
 */
export async function VolverAlTicket({
  ticketId,
  codigo,
  pista = false,
  variante = 'secundario',
}: {
  ticketId: string
  codigo?: string
  /** Una línea corta debajo: para qué sirve volver. */
  pista?: boolean
  variante?: 'secundario' | 'primario'
}) {
  let cod = codigo
  if (!cod) {
    const supabase = await createClient()
    const { data } = await supabase.from('tickets').select('codigo').eq('id', ticketId).maybeSingle()
    cod = (data as { codigo: string } | null)?.codigo
  }
  return <BotonVolverTicket ticketId={ticketId} codigo={cod} pista={pista} variante={variante} />
}

export function BotonVolverTicket({
  ticketId,
  codigo,
  pista = false,
  variante = 'secundario',
}: {
  ticketId: string
  codigo?: string
  pista?: boolean
  variante?: 'secundario' | 'primario'
}) {
  return (
    <div data-volver-ticket className="flex flex-col items-start gap-1">
      <BotonLink
        href={`/tickets/${ticketId}`}
        variante={variante}
        className="max-w-full !h-auto min-h-11 py-2 text-left"
      >
        <IconChevronLeft className="h-4 w-4 shrink-0" />
        <span className="break-words">Volver al ticket{codigo ? ` ${codigo}` : ''}</span>
      </BotonLink>
      {pista && (
        <p className="text-xs text-slate-600">Ahí agregas otro equipo o cierras el ticket.</p>
      )}
    </div>
  )
}

/**
 * «Guardado» con las dos salidas obvias. Se muestra en la página del horómetro tras guardar
 * (llega con ?guardado=labor|horometro).
 */
export function AvisoGuardado({
  tipo,
  ticketId,
  horometroId,
  codigo,
  puedeAgregarLabor,
}: {
  tipo: 'labor' | 'horometro'
  ticketId: string
  horometroId: string
  codigo: string
  puedeAgregarLabor: boolean
}) {
  return (
    <div data-aviso-guardado className="flex flex-col gap-2">
      <Alerta tono="azul">
        <strong>Guardado.</strong>{' '}
        {tipo === 'labor' ? 'La labor quedó registrada en este equipo.' : 'Los datos del horómetro quedaron guardados.'}{' '}
        ¿Qué sigue?
      </Alerta>
      <div className="flex flex-col gap-2 sm:flex-row">
        {puedeAgregarLabor && (
          <BotonLink
            href={`/tickets/${ticketId}/horometros/${horometroId}/registros/nuevo`}
            className="max-w-full"
          >
            <IconPlus className="h-4 w-4 shrink-0" />
            Agregar otra labor
          </BotonLink>
        )}
        <BotonLink href={`/tickets/${ticketId}`} variante="secundario" className="max-w-full !h-auto min-h-11 py-2">
          <IconChevronLeft className="h-4 w-4 shrink-0" />
          <span className="break-words">Volver al ticket {codigo}</span>
        </BotonLink>
      </div>
    </div>
  )
}
