'use client'

/** Estado de cumplimiento de una fila (tiempo y cantidad) con icono + texto + color. Nunca solo color. */

import { CLASES_TONO, Insignia, type Tono } from '@/components/ui/Primitivos'
import { cantidad as fmt } from '@/lib/fertirriego/calculos'
import { textoTiempo, type FilaCumplimiento, type Tiempo } from '@/lib/inyeccion/cumplimiento'

export const TONO_TIEMPO: Record<Tiempo, { tono: Tono; icono: string }> = {
  a_tiempo: { tono: 'verde', icono: '✔' },
  tarde: { tono: 'ambar', icono: '▲' },
  temprano: { tono: 'azul', icono: '▼' },
  vencido: { tono: 'rojo', icono: '✖' },
  pendiente: { tono: 'gris', icono: '○' },
  sin_plan: { tono: 'violeta', icono: '◇' },
  sin_fecha: { tono: 'gris', icono: '–' },
}

export function InsigniasCumplimiento({ fila, unidad = '' }: { fila: Pick<FilaCumplimiento, 'tiempo' | 'dias' | 'cantidad' | 'dif_cantidad' | 'dif_pct'>; unidad?: string }) {
  const t = TONO_TIEMPO[fila.tiempo]
  return (
    <span className="flex flex-wrap items-center gap-1" data-cumplimiento={fila.tiempo}>
      <Insignia tono={t.tono}>
        <span aria-hidden="true">{t.icono}</span>
        {textoTiempo(fila)}
      </Insignia>
      {fila.cantidad === 'exacto' && (
        <Insignia tono="verde">
          <span aria-hidden="true">＝</span>Cantidad correcta
        </Insignia>
      )}
      {fila.cantidad === 'de_mas' && (
        <Insignia tono="ambar">
          <span aria-hidden="true">＋</span>
          De más {fila.dif_cantidad !== null ? `${fmt(fila.dif_cantidad)} ${unidad}`.trim() : ''}
          {fila.dif_pct !== null ? ` (${fmt(fila.dif_pct)} %)` : ''}
        </Insignia>
      )}
      {fila.cantidad === 'de_menos' && (
        <Insignia tono="rojo">
          <span aria-hidden="true">−</span>
          De menos {fila.dif_cantidad !== null ? `${fmt(Math.abs(fila.dif_cantidad))} ${unidad}`.trim() : ''}
          {fila.dif_pct !== null ? ` (${fmt(Math.abs(fila.dif_pct))} %)` : ''}
        </Insignia>
      )}
    </span>
  )
}

/** Color del punto de estado (mismo tono que la insignia). */
export const PUNTO_TONO: Record<Tono, string> = {
  verde: 'bg-emerald-500',
  ambar: 'bg-amber-500',
  azul: 'bg-sky-500',
  rojo: 'bg-red-500',
  gris: 'bg-slate-400',
  violeta: 'bg-violet-500',
} as Record<Tono, string>

const TEXTO_CORTO: Record<Tiempo, (dias: number) => string> = {
  a_tiempo: () => 'A tiempo',
  tarde: (d) => `+${d} d`,
  temprano: (d) => `−${d} d`,
  vencido: () => 'Sin aplicar',
  pendiente: () => 'Aún no toca',
  sin_plan: () => 'Sin plan',
  sin_fecha: () => 'Sin fecha',
}

export const textoCorto = (f: Pick<FilaCumplimiento, 'tiempo' | 'dias'>) => TEXTO_CORTO[f.tiempo](Math.abs(f.dias ?? 0))

/** Estado en una sola insignia pequeña (icono + texto corto) y, si difiere, la cantidad (+ / −). */
export function EstadoCompacto({ fila }: { fila: Pick<FilaCumplimiento, 'tiempo' | 'dias' | 'cantidad' | 'dif_pct'> }) {
  const t = TONO_TIEMPO[fila.tiempo]
  return (
    <span className="inline-flex shrink-0 items-center gap-1" data-cumplimiento={fila.tiempo}>
      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ring-1 ring-inset ${CLASES_TONO[t.tono]}`}>
        <span aria-hidden="true">{t.icono}</span>
        {textoCorto(fila)}
      </span>
      {fila.cantidad === 'de_mas' && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-amber-800 ring-1 ring-inset ring-amber-600/20">＋ de más</span>}
      {fila.cantidad === 'de_menos' && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-red-800 ring-1 ring-inset ring-red-600/20">− de menos</span>}
    </span>
  )
}
