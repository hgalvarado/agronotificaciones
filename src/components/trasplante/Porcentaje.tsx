/**
 * El porcentaje de cumplimiento, con su color.
 *
 * Vive en su propio archivo y no dentro del cuadre porque lo usan las dos
 * pantallas del módulo, y una de ellas —el reporte de gerencia— se
 * imprime desde el servidor: importarlo del cuadro, que es un componente
 * de cliente, arrastraría al reporte todo el JavaScript de los filtros y
 * los interruptores para dibujar un número de dos dígitos.
 */

import { semaforo } from '@/lib/trasplante/formato'

export function Porcentaje({ valor }: { valor: number | null }) {
  if (valor === null || valor === undefined) return <span className="text-slate-300">—</span>
  const v = Number(valor)
  // Semáforo de la guía corporativa (82): ≥100 % verde vibrante, 80–99 %
  // amarillo sol, <80 % naranja atardecer.
  const s = semaforo(v)
  const tono =
    s === 'excelente'
      ? 'bg-lima-100 text-lima-800'
      : s === 'progreso'
        ? 'bg-sol-100 text-sol-800'
        : 'bg-naranja-100 text-naranja-800'
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${tono}`}>
      {v.toFixed(0)}%
    </span>
  )
}
