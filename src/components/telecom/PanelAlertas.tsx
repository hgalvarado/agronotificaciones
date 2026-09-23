'use client'

/**
 * Lo que hay que ir a resolver hoy, arriba del todo.
 *
 * Dos preguntas y ninguna necesita una tabla: qué contrato temporal se
 * vence —hay que ir a recoger ese teléfono— y a qué equipo ya le tocaba
 * renovación. Lo demás del módulo son listas para consultar; esto es lo
 * único que pide una acción.
 *
 * El color lo decide `urgencia`, que es puro y vive en `tipos`: rojo
 * sólo para lo vencido o lo de hoy. Pintarlo todo de rojo enseña a
 * ignorar el rojo.
 */

import { useMemo, useState } from 'react'
import { Tarjeta } from '@/components/ui/Primitivos'
import { IconCalendar, IconGauge } from '@/components/ui/Icons'
import { textoPlazo, urgencia, type Alerta, type TipoAlerta } from '@/lib/telecom/tipos'

const TONOS = {
  roja: 'border-red-200 bg-red-50 text-red-800',
  ambar: 'border-amber-200 bg-amber-50 text-amber-800',
  gris: 'border-slate-200 bg-white text-slate-600',
} as const

export function PanelAlertas({
  alertas,
  onAbrir,
}: {
  alertas: Alerta[]
  /** Llevar a la pestaña que corresponde, ya filtrada por lo que se tocó. */
  onAbrir?: (tipo: TipoAlerta, llave: string) => void
}) {
  // Lo vencido primero, aunque la consulta cambiara de orden: es lo
  // único que se mira cuando hay veinte avisos.
  const lista = useMemo(() => [...alertas].sort((a, b) => a.dias - b.dias), [alertas])
  const [todas, setTodas] = useState(false)

  const urgentes = lista.filter((a) => a.dias <= 7)
  const visibles = todas ? lista : urgentes.length > 0 ? urgentes : lista.slice(0, 3)

  if (lista.length === 0) {
    return (
      <Tarjeta className="px-4 py-3">
        <p className="text-sm font-semibold text-emerald-700">Nada pendiente</p>
        <p className="text-xs text-slate-400">
          Ninguna devolución por vencer y ningún equipo con renovación cumplida.
        </p>
      </Tarjeta>
    )
  }

  const vencidas = lista.filter((a) => a.dias <= 0).length

  return (
    <Tarjeta className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">
          Pendientes
          {vencidas > 0 && (
            <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
              {vencidas} vencido{vencidas === 1 ? '' : 's'}
            </span>
          )}
        </h2>
        {lista.length > visibles.length && (
          <button
            type="button"
            onClick={() => setTodas(true)}
            className="text-xs font-semibold text-brand-700 hover:underline"
          >
            Ver los {lista.length}
          </button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {visibles.map((a) => {
          const tono = TONOS[urgencia(a.dias)]
          const esDevolucion = a.tipo === 'DEVOLUCION'
          return (
            <button
              key={`${a.tipo}-${a.llave}`}
              type="button"
              onClick={() => onAbrir?.(a.tipo, a.llave)}
              className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors hover:brightness-95 ${tono}`}
            >
              <span className="mt-0.5 shrink-0 opacity-70">
                {esDevolucion ? (
                  <IconCalendar className="h-4 w-4" />
                ) : (
                  <IconGauge className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold uppercase tracking-wide opacity-70">
                  {esDevolucion ? 'Devolución pactada' : 'Renovación cumplida'}
                </span>
                <span className="block truncate text-sm font-semibold">
                  {a.detalle ?? a.que}
                </span>
                <span className="block truncate text-xs opacity-80">
                  {a.quien ?? 'Sin asignar'} · {textoPlazo(a.dias)}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <p className="text-[11px] text-slate-400">
        Las fechas se comparan contra el día de Honduras (UTC-6), no contra el del servidor: una
        alerta que aparece medio día antes se aprende a ignorar.
      </p>
    </Tarjeta>
  )
}
