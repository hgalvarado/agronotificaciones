'use client'

/**
 * De dónde salen las partes por millón, variable por variable.
 *
 * **Por qué existe esta pantalla.** Las ppm son el número con el que se
 * discute si la aplicación quedó bien, y un número que no se puede
 * auditar no se discute: se cree o no se cree. Enseñar sólo el resultado
 * obliga a rehacer la cuenta a mano en una libreta para poder dudar de
 * él — y quien está en el campo con el teléfono no la rehace: la cree, o
 * la descarta entera.
 *
 * Así que esto enseña las diez filas del desglose en el mismo orden en
 * que se calculan, cada una con su unidad. Es de sólo lectura a
 * propósito: lo que haya que corregir se corrige en su campo, no aquí.
 */

import { Modal } from '@/components/ui/Modal'
import { Boton } from '@/components/ui/Primitivos'
import { n2 } from '@/lib/trasplante/formato'
import type { DesglosePpm } from '@/lib/desinfeccion/calculo'

/** Una fila del desglose: qué es, cuánto vale y en qué unidad. */
type Renglon = {
  concepto: string
  valor: string
  /** Los resultados intermedios y el final se marcan: no son entradas. */
  derivado?: boolean
}

export function DesglosePpmModal({
  desglose,
  onCerrar,
}: {
  desglose: DesglosePpm
  onCerrar: () => void
}) {
  const d = desglose
  // Un hueco se escribe «—» y no «0»: cero es un dato y aquí casi
  // siempre significa «todavía no se capturó».
  const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : n2(v))

  const renglones: Renglon[] = [
    { concepto: 'Caudal', valor: `${num(d.caudal)} m³/h` },
    { concepto: 'Horas de aplicación', valor: `${num(d.horasInyeccion)} h` },
    { concepto: 'Horas de lavado', valor: `${num(d.horasLavado)} h` },
    { concepto: 'Total caudal', valor: `${num(d.aguaTotal)} m³`, derivado: true },
    { concepto: 'Dosis por manzana', valor: `${num(d.dosisMz)} L/mz`, derivado: true },
    { concepto: 'Producto químico', valor: d.producto },
    {
      concepto: 'I.A. (%)',
      valor: d.concentracion === null ? '— (falta en el catálogo)' : `${num(d.concentracion)} %`,
    },
    { concepto: 'Producto puro', valor: `${num(d.productoPuroLitros)} L`, derivado: true },
    { concepto: 'Producto puro a cc', valor: `${num(d.productoPuroCc)} cc`, derivado: true },
  ]

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Cálculo de las ppm" ancho="ancho">
      <div className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {renglones.map((r) => (
                <tr key={r.concepto} className="border-b border-slate-100 last:border-0">
                  <th
                    scope="row"
                    className={`py-2 pr-3 text-left font-normal ${
                      r.derivado ? 'text-slate-500' : 'text-slate-700'
                    }`}
                  >
                    {r.concepto}
                    {r.derivado && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-300">
                        calculado
                      </span>
                    )}
                  </th>
                  <td className="py-2 text-right font-semibold tabular-nums text-slate-900">
                    {r.valor}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200">
                <th scope="row" className="py-2.5 pr-3 text-left font-semibold text-slate-900">
                  Concentración de aplicación
                </th>
                <td className="py-2.5 text-right text-base font-bold tabular-nums text-brand-700">
                  {d.ppm === null ? '—' : `${n2(d.ppm)} ppm`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-500 ring-1 ring-inset ring-slate-200">
          Producto puro en cc entre el agua total en m³. Un metro cúbico de agua pesa un millón de
          gramos y un centímetro cúbico de producto pesa aproximadamente uno: por eso los cc por m³
          ya <strong>son</strong> partes por millón, sin ningún factor más.
        </p>

        {d.ppm === null && (
          <p className="text-xs text-amber-700">
            {d.concentracion === null
              ? 'Falta la concentración del producto en Catálogos → Materiales.'
              : 'Falta el caudal o las horas de inyección y lavado del turno.'}
          </p>
        )}

        <Boton variante="secundario" className="w-full" onClick={onCerrar}>
          Cerrar
        </Boton>
      </div>
    </Modal>
  )
}
