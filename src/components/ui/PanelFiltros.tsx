'use client'

/**
 * Panel de filtros GLOBALES: el rango de fechas de la consulta y los
 * selectores que acotan toda la pantalla.
 *
 * Es distinto de los embudos del encabezado a propósito. El embudo recorta
 * lo que YA está cargado; esto decide qué se carga y sobre qué se trabaja.
 * Mezclarlos haría creer que ampliar un filtro de columna trae datos
 * nuevos de la base, y no los trae.
 */

import type { ReactNode } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from './Primitivos'

export function PanelFiltros({
  desde,
  hasta,
  onDesde,
  onHasta,
  onConsultar,
  cargando,
  activos,
  onLimpiar,
  ayuda,
  children,
}: {
  /**
   * El rango es OPCIONAL. Hay módulos que no se consultan por fecha:
   * el riego se organiza por ciclo de cultivo, y un «desde/hasta» sobre
   * la fecha de siembra escondía justo lo que se acababa de capturar.
   * Sin `desde`/`hasta` el panel sale sólo con sus selectores.
   */
  desde?: string
  hasta?: string
  onDesde?: (v: string) => void
  onHasta?: (v: string) => void
  onConsultar?: () => void
  cargando?: boolean
  /** Cuántos selectores están recortando algo ahora mismo. */
  activos: number
  onLimpiar: () => void
  ayuda?: ReactNode
  /** Los selectores de la pantalla. */
  children: ReactNode
}) {
  const hayRango = desde !== undefined && hasta !== undefined

  return (
    <Tarjeta className="flex flex-col gap-3 p-4">
      {hayRango && (
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Desde" className="min-w-[150px]">
            <Entrada type="date" value={desde} onChange={(e) => onDesde?.(e.target.value)} />
          </Campo>
          <Campo etiqueta="Hasta" className="min-w-[150px]">
            <Entrada type="date" value={hasta} onChange={(e) => onHasta?.(e.target.value)} />
          </Campo>
          <Boton onClick={onConsultar} disabled={cargando}>
            {cargando ? 'Consultando…' : 'Consultar'}
          </Boton>
        </div>
      )}

      <div
        className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 ${
          hayRango ? 'border-t border-slate-100 pt-3' : ''
        }`}
      >
        {children}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {ayuda && <p className="flex-1 text-xs text-slate-400">{ayuda}</p>}
        {activos > 0 && (
          <Boton variante="secundario" tamano="sm" onClick={onLimpiar}>
            Limpiar {activos} {activos === 1 ? 'filtro' : 'filtros'}
          </Boton>
        )}
      </div>
    </Tarjeta>
  )
}
