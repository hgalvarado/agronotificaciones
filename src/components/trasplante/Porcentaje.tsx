/**
 * El porcentaje de cumplimiento, con su color.
 *
 * Vive en su propio archivo y no dentro del cuadre porque lo usan las dos
 * pantallas del módulo, y una de ellas —el reporte de gerencia— se
 * imprime desde el servidor: importarlo del cuadro, que es un componente
 * de cliente, arrastraría al reporte todo el JavaScript de los filtros y
 * los interruptores para dibujar un número de dos dígitos.
 */

export function Porcentaje({ valor }: { valor: number | null }) {
  if (valor === null || valor === undefined) return <span className="text-slate-300">—</span>
  const v = Number(valor)
  const tono =
    v >= 99
      ? 'bg-emerald-100 text-emerald-800'
      : v >= 50
        ? 'bg-brand-50 text-brand-800'
        : 'bg-amber-100 text-amber-800'
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${tono}`}>
      {v.toFixed(0)}%
    </span>
  )
}
