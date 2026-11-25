'use client'

/** Estado de cumplimiento de una fila (tiempo y cantidad) con icono + texto + color. Nunca solo color. */

import { InsigniaSobria } from '@/components/ui/Banda'
import type { Tono } from '@/components/ui/Primitivos'
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
      <InsigniaSobria tono={t.tono}>
        <span aria-hidden="true">{t.icono}</span>
        {textoTiempo(fila)}
      </InsigniaSobria>
      {fila.cantidad === 'exacto' && (
        <InsigniaSobria tono="verde">
          <span aria-hidden="true">＝</span>Cantidad correcta
        </InsigniaSobria>
      )}
      {fila.cantidad === 'de_mas' && (
        <InsigniaSobria tono="ambar">
          <span aria-hidden="true">＋</span>
          De más {fila.dif_cantidad !== null ? `${fmt(fila.dif_cantidad)} ${unidad}`.trim() : ''}
          {fila.dif_pct !== null ? ` (${fmt(fila.dif_pct)} %)` : ''}
        </InsigniaSobria>
      )}
      {fila.cantidad === 'de_menos' && (
        <InsigniaSobria tono="rojo">
          <span aria-hidden="true">−</span>
          De menos {fila.dif_cantidad !== null ? `${fmt(Math.abs(fila.dif_cantidad))} ${unidad}`.trim() : ''}
          {fila.dif_pct !== null ? ` (${fmt(Math.abs(fila.dif_pct))} %)` : ''}
        </InsigniaSobria>
      )}
    </span>
  )
}

/** Color de la banda lateral de estado (mismo tono que la insignia). */
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
      <InsigniaSobria tono={t.tono}>
        <span aria-hidden="true">{t.icono}</span>
        {textoCorto(fila)}
      </InsigniaSobria>
      {fila.cantidad === 'de_mas' && <InsigniaSobria tono="ambar">＋ de más</InsigniaSobria>}
      {fila.cantidad === 'de_menos' && <InsigniaSobria tono="rojo">− de menos</InsigniaSobria>}
    </span>
  )
}
