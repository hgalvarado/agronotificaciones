import { AZUL, n2, n2Compacto } from '@/lib/reporte-maquinaria/formato'
import { repartirEnColumnas } from '@/lib/reporte-maquinaria/distribucion'
import type { FilaHorometro } from '@/lib/reporte-maquinaria/tipos'

/**
 * Resumen de horómetros, ya deduplicado en la base: una fila por lectura.
 *
 * Se reparte en varias columnas porque un día de 36 equipos en una sola
 * lista empuja el pie a una segunda hoja para nada. Cada columna es su
 * propia tabla y no una columna CSS: así cada bloque conserva su
 * encabezado, que es lo que se pierde cuando `column-count` parte una
 * tabla por la mitad.
 *
 * Esto vale SÓLO para este resumen. El detalle operativo sigue a todo el
 * ancho, que es donde de verdad hacen falta las diez columnas.
 */
export function TablaHorometros({
  filas,
  totalHoras,
  totalHombre,
}: {
  filas: FilaHorometro[]
  totalHoras: number
  totalHombre: number
}) {
  if (filas.length === 0) return null

  const columnas = repartirEnColumnas(filas)
  // El número de la primera fila de cada columna. La numeración es del
  // resumen completo, no de cada tabla: es la que cita el detalle.
  const arranques = columnas.reduce<number[]>((acc, grupo, i) => {
    acc.push(i === 0 ? 1 : acc[i - 1] + columnas[i - 1].length)
    return acc
  }, [])

  return (
    <section className="tabla-horometros break-inside-avoid">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
        Resumen de horómetros
      </h2>

      {/* En celular va una debajo de otra —cuatro columnas de cinco
          campos en 390 px no se leen—; desde `sm` y al imprimir se
          reparten en las que haga falta. */}
      {/* Con una sola columna se le pone tope de ancho: estirar cinco
          celdas estrechas a lo largo de media hoja deja unos huecos que
          se leen como si faltaran datos. */}
      <div
        className={`grid grid-cols-1 gap-x-2 gap-y-3 sm:[grid-template-columns:var(--cols)] print:[grid-template-columns:var(--cols)] ${
          columnas.length === 1 ? 'max-w-sm' : ''
        }`}
        style={{ '--cols': `repeat(${columnas.length}, minmax(0, 1fr))` } as React.CSSProperties}
      >
        {columnas.map((grupo, i) => (
          // `table-fixed` con anchos declarados: en automático, el
          // contenido más largo estira la tabla más allá de su columna y
          // la familia de una se monta encima del equipo de la de al lado.
          <table key={i} className="w-full table-fixed border-collapse text-[9px]">
            <colgroup>
              <col className="w-[7%]" />
              <col className="w-[19%]" />
              <col className="w-[19%]" />
              <col className="w-[19%]" />
              <col className="w-[15%]" />
              <col className="w-[21%]" />
            </colgroup>
            <thead>
              <tr
                className="text-left text-[8px] font-bold uppercase tracking-wide text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
                style={{ backgroundColor: AZUL }}
              >
                <th className="px-0.5 py-1 text-center">#</th>
                <th className="px-0.5 py-1">Equipo</th>
                <th className="px-0.5 py-1 text-right">Ini.</th>
                <th className="px-0.5 py-1 text-right">Fin.</th>
                <th className="py-1 pl-0.5 pr-1.5 text-right">Hrs</th>
                <th className="px-0.5 py-1">Familia</th>
              </tr>
            </thead>
            <tbody>
              {grupo.map((f, j) => (
                <tr
                  key={`${f.equipo_codigo}-${f.horometro_inicial}-${f.horometro_final}`}
                  className="border-b border-slate-100"
                >
                  {/* El mismo número que lleva el equipo en el detalle. */}
                  <td className="px-0.5 py-0.5 text-center font-bold tabular-nums text-slate-400">
                    {arranques[i] + j}
                  </td>
                  <td className="truncate px-0.5 py-0.5 font-semibold text-slate-800">
                    {f.equipo_codigo}
                  </td>
                  <td className="px-0.5 py-0.5 text-right tabular-nums text-slate-600">
                    {n2Compacto(f.horometro_inicial)}
                  </td>
                  <td className="px-0.5 py-0.5 text-right tabular-nums text-slate-600">
                    {n2Compacto(f.horometro_final)}
                  </td>
                  <td className="py-0.5 pl-0.5 pr-1.5 text-right font-semibold tabular-nums text-slate-900">
                    {n2Compacto(f.horas_maquina)}
                  </td>
                  {/* La familia va un punto más pequeña: es el dato más largo
                      de la fila y el menos consultado, así que es el que
                      cede el ancho. */}
                  <td className="truncate px-0.5 py-0.5 text-[8px] text-slate-500">
                    {f.familia ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>

      {/* El total va fuera de las tablas: repartido, cada columna tendría
          su propio subtotal y ninguno sería el del día. */}
      <p
        className="mt-2 flex flex-wrap justify-end gap-x-4 border-t-2 pt-1 text-[11px] font-bold tabular-nums text-slate-800"
        style={{ borderColor: AZUL }}
      >
        <span>
          Equipos: <span className="tabular-nums">{filas.length}</span>
        </span>
        <span>Horas máquina: {n2(totalHoras)}</span>
        <span>Horas hombre: {n2(totalHombre)}</span>
      </p>
    </section>
  )
}
