'use client'

/** Estado de cumplimiento de una fila (tiempo y cantidad) con icono + texto + color. Nunca solo color. */

import { Insignia, type Tono } from '@/components/ui/Primitivos'
import { cantidad as fmt } from '@/lib/fertirriego/calculos'
import { textoTiempo, type FilaCumplimiento, type Tiempo } from '@/lib/inyeccion/cumplimiento'

const TONO_TIEMPO: Record<Tiempo, { tono: Tono; icono: string }> = {
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
