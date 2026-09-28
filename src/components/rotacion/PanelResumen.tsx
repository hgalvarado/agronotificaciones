'use client'

/**
 * Los cuatro números de arriba: cómo va la rotación de la temporada.
 *
 * Son las preguntas que se hacen antes de mirar ninguna tabla —cuánto
 * había que sembrar, cuánto se lleva, cuánto falta— y contestarlas
 * sumando filas a mano es lo que hace que nadie las conteste.
 *
 * Sólo dibuja. Los números vienen sumados de la base.
 */

import { Tarjeta } from '@/components/ui/Primitivos'
import { n0, n2, pct, type Estadisticas } from '@/lib/rotacion/tipos'

export function PanelResumen({ datos }: { datos: Estadisticas | null }) {
  if (!datos) return null

  const avance = Number(datos.pct ?? 0)
  // Pendiente NEGATIVO significa que se sembró de más, y se dice: es
  // también una desviación del plan y esconderla sería cómodo y falso.
  const pasado = Number(datos.pendiente) < 0

  return (
    <Tarjeta className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Dato
          valor={`${n2(datos.area_plan)} mz`}
          etiqueta="Área planificada"
          detalle={`${n0(datos.lotes_plan)} ${Number(datos.lotes_plan) === 1 ? 'lote' : 'lotes'}`}
        />
        <Dato
          valor={`${n2(datos.area_real)} mz`}
          etiqueta="Avance real"
          detalle={`${n0(datos.lotes_real)} ${Number(datos.lotes_real) === 1 ? 'lote' : 'lotes'} sembrados`}
          tono="text-brand-700"
        />
        <Dato
          valor={`${n2(Math.abs(Number(datos.pendiente)))} mz`}
          etiqueta={pasado ? 'Sembrado de más' : 'Área pendiente'}
          tono={pasado ? 'text-amber-700' : 'text-slate-900'}
        />
        <Dato
          valor={pct(datos.pct)}
          etiqueta="Avance"
          detalle={`L ${n2(datos.costo_total)} de costo`}
          tono={avance >= 100 ? 'text-emerald-700' : 'text-slate-900'}
        />
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all ${
            avance >= 100 ? 'bg-emerald-600' : 'bg-brand-600'
          }`}
          style={{ width: `${Math.min(100, Math.max(0, avance))}%` }}
        />
      </div>
    </Tarjeta>
  )
}

function Dato({
  valor,
  etiqueta,
  detalle,
  tono = 'text-slate-900',
}: {
  valor: string
  etiqueta: string
  detalle?: string
  tono?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className={`text-xl font-bold tracking-tight ${tono}`}>{valor}</p>
      <p className="text-[11px] font-medium text-slate-400">{etiqueta}</p>
      {detalle && <p className="text-[11px] text-slate-300">{detalle}</p>}
    </div>
  )
}
