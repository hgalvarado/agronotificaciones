import { AZUL, n2, operadorLegible, turnoLegible } from '@/lib/reporte-maquinaria/formato'
import { construirIndice, marcarFinDeBloque, numeroDeFila } from '@/lib/reporte-maquinaria/agrupacion'
import type { FilaDetalle, FilaHorometro } from '@/lib/reporte-maquinaria/tipos'

const COLUMNAS = 10

/**
 * Detalle operativo del día: una fila por lote trabajado.
 *
 * Tres cosas que no son adorno:
 *
 *  · El membrete va DENTRO del `<thead>`. Un `thead` se repite solo al
 *    principio de cada hoja impresa, así que la segunda página sale con
 *    su encabezado y sus títulos de columna en vez de empezar a media
 *    tabla sin saber de qué es.
 *  · Cada tractor lleva el número de su lectura en el resumen de abajo,
 *    y una línea al cerrar su bloque. Con veinte filas seguidas, saber
 *    dónde acaba un equipo y empieza otro es la mitad de la lectura.
 *  · De la tarea sólo sale el código: el nombre repetía lo que ya dice
 *    la labor y se comía el ancho que necesitan las diez columnas.
 */
export function TablaDetalle({
  filas,
  horometros,
  totalMz,
  encabezado,
}: {
  filas: FilaDetalle[]
  horometros: FilaHorometro[]
  totalMz: number
  /** El membrete, para que se repita en cada hoja impresa. */
  encabezado: React.ReactNode
}) {
  if (filas.length === 0) return null

  const indice = construirIndice(horometros)
  const finDeBloque = marcarFinDeBloque(filas)

  return (
    <section>
      <div className="scroll-suave overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-[13px] print:min-w-0">
          <thead className="table-header-group">
            {/* Sólo al imprimir: en pantalla el membrete va suelto arriba,
                donde no tiene que caber en el ancho de la tabla. */}
            <tr className="hidden print:table-row">
              <th colSpan={COLUMNAS} className="pb-2 font-normal">
                {encabezado}
              </th>
            </tr>
            <tr
              className="text-left text-[10px] font-bold uppercase tracking-wide text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
              style={{ backgroundColor: AZUL }}
            >
              <th className="px-2 py-1.5 print:px-1 print:py-0.5">Turno</th>
              <th className="px-2 py-1.5 print:px-1 print:py-0.5">Ubicación técnica</th>
              <th className="px-2 py-1.5 print:px-1 print:py-0.5">Labor</th>
              <th className="px-2 py-1.5 print:px-1 print:py-0.5">Tarea</th>
              <th className="px-2 py-1.5 print:px-1 print:py-0.5">Puesto de trabajo</th>
              <th className="px-2 py-1.5 print:px-1 print:py-0.5">Equipo</th>
              <th className="px-2 py-1.5 text-right print:px-1 print:py-0.5">H. máquina</th>
              <th className="px-2 py-1.5 text-right print:px-1 print:py-0.5">Avance mz</th>
              <th className="px-2 py-1.5 text-right print:px-1 print:py-0.5">H. hombre</th>
              <th className="px-2 py-1.5 print:px-1 print:py-0.5">Operador</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => {
              const numero = numeroDeFila(f, indice, horometros)
              const cierra = finDeBloque[i]
              return (
                <tr
                  key={f.detalle_id}
                  className={
                    cierra ? 'border-b-2 border-slate-400' : 'border-b border-slate-100'
                  }
                >
                  <td className="whitespace-nowrap px-2 py-1 text-slate-500 print:px-1 print:py-0">
                    {turnoLegible(f.turno)}
                  </td>
                  <td className="px-2 py-1 print:px-1 print:py-0">
                    <span className="font-semibold text-slate-800">{f.ubicacion_tecnica}</span>
                    {f.lote_nombre && (
                      <span className="block text-[11px] text-slate-400">
                        {f.lote_nombre}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-slate-700 print:px-1 print:py-0">{f.labor}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-600 print:px-1 print:py-0">
                    {f.tarea_codigo}
                  </td>
                  <td className="px-2 py-1 text-slate-600 print:px-1 print:py-0">
                    {f.puesto_trabajo ?? '—'}
                    {f.implemento && (
                      <span className="block text-[11px] text-slate-400">
                        {f.implemento}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 print:px-1 print:py-0">
                    <span className="font-semibold text-slate-800">{f.equipo_codigo}</span>
                    {numero !== null && <Indice numero={numero} />}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-600 print:px-1 print:py-0">
                    {n2(f.horas_maquina)}
                  </td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900 print:px-1 print:py-0">
                    {n2(f.avance_mz)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-600 print:px-1 print:py-0">
                    {n2(f.horas_hombre)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-600 print:px-1 print:py-0">
                    {operadorLegible(f.operador_codigo, f.operador_nombre)}
                  </td>
                </tr>
              )
            })}
            <tr className="border-t-2 text-sm font-bold" style={{ borderColor: AZUL }}>
              <td className="px-2 py-1.5 print:px-1 print:py-0.5" colSpan={7}>
                Total avance del día
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums print:px-1 print:py-0.5">
                {n2(totalMz)}
              </td>
              <td className="px-2 py-1.5 print:px-1" colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * El número de la lectura de horómetro, al lado del equipo. Es el mismo
 * que numera la fila del resumen de abajo: sirve para ir de una labor a
 * las horas de las que salió sin tener que buscar por el código.
 */
function Indice({ numero }: { numero: number }) {
  return (
    <span
      className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:h-3 print:w-3 print:text-[7px]"
      style={{ backgroundColor: AZUL }}
      title={`Horómetro ${numero} del resumen`}
    >
      {numero}
    </span>
  )
}
