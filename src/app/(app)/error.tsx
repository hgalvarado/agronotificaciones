'use client'

/**
 * Cuando una pantalla de la aplicación falla.
 *
 * A diferencia de `global-error`, aquí el menú y la sesión siguen en pie:
 * sólo se cayó el contenido. Por eso se ofrece reintentar y también salir
 * a Tickets, que es a donde va a querer ir quien se quedó atascado.
 */

import { Alerta, Boton, BotonLink, Tarjeta } from '@/components/ui/Primitivos'
import { mensajeDeError } from '@/lib/errores'

export default function ErrorPantalla({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4 lg:p-6">
      <Tarjeta className="flex flex-col gap-4 p-5">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-slate-900">
            Esta pantalla no se pudo cargar
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Lo que ya estaba guardado no se perdió. Reintenta; si vuelve a fallar, avísale a Torre
            de Control con el código de abajo.
          </p>
        </div>

        <Alerta>{mensajeDeError(error, 'Error inesperado.')}</Alerta>

        <div className="flex flex-wrap gap-2">
          <Boton onClick={reset}>Reintentar</Boton>
          <BotonLink variante="secundario" href="/tickets">
            Ir a Tickets
          </BotonLink>
        </div>

        {error.digest && <p className="text-xs text-slate-400">Código: {error.digest}</p>}
      </Tarjeta>
    </div>
  )
}
