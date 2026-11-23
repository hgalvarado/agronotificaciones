'use client'

/**
 * Indicador compacto de conexión para el menú de Campo (como WhatsApp): «En línea» / «Sin señal», cuántos registros
 * esperan señal y cuántos tienen error. Al tocarlo lleva a la pantalla de Campo donde se abre el panel «Envíos».
 */

import Link from 'next/link'
import { useEstadoConexion } from '@/lib/fertirriego/useEstadoConexion'

export function IndicadorConexion({ usuarioId, rutaEnvios }: { usuarioId: string; rutaEnvios: string | null }) {
  const { enLinea, pendientes, rechazados } = useEstadoConexion(usuarioId)
  const color = rechazados > 0 ? 'bg-red-50 text-red-800 ring-red-600/30' : enLinea ? 'bg-brand-50 text-brand-800 ring-brand-600/20' : 'bg-slate-100 text-slate-700 ring-slate-400/30'
  const contenido = (
    <>
      <span className={`h-2.5 w-2.5 rounded-full ${enLinea ? 'bg-brand-600' : 'bg-slate-500'}`} />
      {enLinea ? 'En línea' : 'Sin señal'}
      {pendientes > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">{pendientes} por enviar</span>}
      {rechazados > 0 && <span className="rounded-full bg-red-600 px-2 py-0.5 text-white">{rechazados} con error</span>}
    </>
  )
  const clase = `inline-flex min-h-11 items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${color}`
  if (rutaEnvios && (pendientes > 0 || rechazados > 0)) {
    return (
      <Link href={`${rutaEnvios}?envios=1`} className={clase} data-indicador-conexion>
        {contenido}
      </Link>
    )
  }
  return (
    <span className={clase} data-indicador-conexion>
      {contenido}
    </span>
  )
}
