'use client'

/**
 * Indicador de conexión del ENCABEZADO de la app (como en WhatsApp), visible en todas las pantallas: punto verde
 * «En línea» / gris «Sin señal», cuántos registros esperan señal y cuántos tienen error. Compacto en el teléfono (solo
 * el punto y el número); desde 640 px escribe «En línea» / «Sin señal». Al tocarlo abre el panel «Envíos»:
 * si la pantalla ya tiene el panel (Fertirriego, Inyección, Motores), lo abre ahí mismo (evento `campo:abrir-envios`);
 * si no, lleva a `/campo?envios=1`, que lo abre. Quien no usa Campo solo ve el estado (sin cola ni botón).
 * Sin sondeos: `navigator.onLine` + eventos, y la cola local se lee al abrir, al volver la señal y cuando Campo la cambia.
 */

import { useRouter } from 'next/navigation'
import { useEstadoConexion } from '@/lib/fertirriego/useEstadoConexion'
import { EVENTO_ABRIR_ENVIOS } from '@/lib/campo/eventos'

export function IndicadorConexion({
  usuarioId,
  conCola = true,
  variante = 'encabezado',
}: {
  usuarioId: string
  /** La persona usa Campo (tiene cola local y el panel «Envíos»). */
  conCola?: boolean
  /** `encabezado` (celular) o `lateral` (escritorio): solo cambia el tamaño del texto y el ancho. */
  variante?: 'encabezado' | 'lateral'
}) {
  const router = useRouter()
  const { enLinea, pendientes, rechazados } = useEstadoConexion(conCola ? usuarioId : null)
  const color =
    rechazados > 0
      ? 'bg-red-50 text-red-800 ring-red-600/30'
      : enLinea
        ? 'bg-brand-50 text-brand-800 ring-brand-600/20'
        : 'bg-slate-100 text-slate-700 ring-slate-400/30'
  const estado = enLinea ? 'en_linea' : 'sin_senal'
  const texto = enLinea ? 'En línea' : 'Sin señal'
  const etiqueta = `Estado de envíos: ${enLinea ? 'en línea' : 'sin señal'}${pendientes ? `, ${pendientes} por enviar` : ''}${rechazados ? `, ${rechazados} con error` : ''}.${conCola ? ' Toca para ver el detalle.' : ''}`
  const ancho = variante === 'lateral' ? 'w-full justify-center' : ''
  const clase = `inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset sm:gap-2 sm:px-3 ${ancho} ${color}`

  const contenido = (
    <>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${enLinea ? 'bg-brand-600' : 'bg-slate-500'}`} />
      <span className={variante === 'lateral' ? '' : 'hidden sm:inline'}>{texto}</span>
      {pendientes > 0 && (
        <span data-pendientes-cuenta className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
          {pendientes}
          <span className={variante === 'lateral' ? '' : 'hidden sm:inline'}> por enviar</span>
        </span>
      )}
      {rechazados > 0 && (
        <span data-errores-cuenta className="rounded-full bg-red-600 px-2 py-0.5 text-white">
          {rechazados}
          <span className={variante === 'lateral' ? '' : 'hidden sm:inline'}> con error</span>
        </span>
      )}
    </>
  )

  if (!conCola) {
    return (
      <span className={clase} data-indicador-conexion data-barra-estado={estado} role="status" aria-label={etiqueta}>
        {contenido}
      </span>
    )
  }

  function alTocar() {
    const pedido = new CustomEvent(EVENTO_ABRIR_ENVIOS, { cancelable: true })
    window.dispatchEvent(pedido)
    // Nadie lo atendió: esta pantalla no tiene el panel «Envíos»; el menú de Campo lo abre al llegar
    if (!pedido.defaultPrevented) router.push('/campo?envios=1')
  }

  return (
    <button type="button" onClick={alTocar} className={clase} data-indicador-conexion data-barra-estado={estado} data-abrir-envios aria-label={etiqueta}>
      {contenido}
    </button>
  )
}
