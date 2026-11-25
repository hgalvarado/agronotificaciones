'use client'

/**
 * El historial de un motor en el FORMATO DE CAMPO (hoja FTR_F-MA-103): una fila por día, todas las columnas a la vez sin scroll
 * lateral (tabla de ancho completo, encabezados abreviados con la jerga de la hoja, los pares inicial/final en dos líneas de la
 * misma celda), scroll vertical con encabezado y totales fijos. Incluye el interruptor «Lista | Tabla» y «Exportar PDF».
 */

import { IconInfo, IconX } from '@/components/ui/Icons'
import { Boton } from '@/components/ui/Primitivos'
import { ddmm, numHoja, totalesHoja, type FilaHoja } from '@/lib/motores/hoja'

export type VistaHistorial = 'lista' | 'tabla'

/** Interruptor «Lista | Tabla» y botones «PDF» y «Excel» (bajan el archivo directo). */
export function BarraVistaHistorial({ vista, onVista, onExportar, puedeExportar }: { vista: VistaHistorial; onVista: (v: VistaHistorial) => void; onExportar: (formato: 'pdf' | 'excel') => void; puedeExportar: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div role="group" aria-label="Vista del historial" className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" data-vista-historial>
        {(['lista', 'tabla'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={vista === v}
            onClick={() => onVista(v)}
            data-vista-historial-opcion={v}
            className={`min-h-9 rounded-md px-3 text-sm font-medium ${vista === v ? 'bg-white text-brand-700 shadow-[var(--shadow-card)]' : 'text-slate-600'}`}
          >
            {v === 'lista' ? 'Lista' : 'Tabla'}
          </button>
        ))}
      </div>
      <Boton tamano="sm" variante="secundario" className="min-h-11" onClick={() => onExportar('pdf')} disabled={!puedeExportar} data-exportar-pdf>
        PDF
      </Boton>
      <Boton tamano="sm" variante="secundario" className="min-h-11" onClick={() => onExportar('excel')} disabled={!puedeExportar} data-exportar-excel>
        Excel
      </Boton>
    </div>
  )
}

const TH = 'sticky top-0 z-10 bg-slate-100 px-0.5 py-1 text-center text-[10px] font-medium leading-tight text-slate-700'
const TD = 'px-0.5 py-1 text-right text-[11px] leading-tight tabular-nums text-slate-900'

function Par({ a, b }: { a: string; b: string }) {
  return (
    <>
      <span className="block">{a}</span>
      <span className="block text-slate-600">{b}</span>
    </>
  )
}

function Marca({ senal }: { senal: FilaHoja['senal'] }) {
  if (!senal) return null
  return senal === 'rojo' ? (
    <span role="img" aria-label="Señal urgente" className="inline-flex text-red-600">
      <IconX className="h-3.5 w-3.5" />
    </span>
  ) : (
    <span role="img" aria-label="Señal de atención" className="inline-flex text-amber-600">
      <IconInfo className="h-3.5 w-3.5" />
    </span>
  )
}

/** La tabla de un motor. */
export function HojaMotor({ titulo, filas }: { titulo: string; filas: FilaHoja[] }) {
  const t = totalesHoja(filas)
  return (
    <section className="flex flex-col gap-1" data-hoja-motor={titulo}>
      <h3 className="text-sm font-medium text-slate-900">{titulo}</h3>
      <div className="max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200">
        <table className="w-full table-fixed border-collapse" data-tabla-hoja>
          <colgroup>
            <col style={{ width: '11%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '5%' }} />
          </colgroup>
          <thead>
            <tr>
              <th className={TH} scope="col">Fecha</th>
              <th className={TH} scope="col"><Par a="Horóm." b="ini · fin" /></th>
              <th className={TH} scope="col">Hrs</th>
              <th className={TH} scope="col" title="Horas estimadas (horómetro dañado o sin lectura)">Est.</th>
              <th className={TH} scope="col"><Par a="Visor" b="ini · fin" /></th>
              <th className={TH} scope="col">Gast.</th>
              <th className={TH} scope="col">Rend.</th>
              <th className={TH} scope="col">RPM</th>
              <th className={TH} scope="col">Sum.</th>
              <th className={TH} scope="col"><Par a="Caudal" b="ini · fin" /></th>
              <th className={TH} scope="col"><span className="sr-only">Señal</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr>
                <td colSpan={11} className="p-3 text-center text-xs text-slate-600">
                  Sin registros.
                </td>
              </tr>
            )}
            {/* ui-ok: la temporada (tope de 400 registros por motor, lo que baja el teléfono) y con scroll vertical propio */}
            {filas.map((f) => (
              <tr key={f.id} className="border-t border-slate-100" data-fila-hoja={f.fecha}>
                <td className="px-0.5 py-1 text-left text-[11px] leading-tight text-slate-900">
                  <span className="block font-medium tabular-nums">{ddmm(f.fecha)}</span>
                </td>
                {f.soloSuministro ? (
                  <td className={TD} colSpan={7} />
                ) : (
                  <>
                    <td className={TD}><Par a={numHoja(f.horoIni)} b={numHoja(f.horoFin)} /></td>
                    <td className={TD}>{numHoja(f.horas)}</td>
                    <td className={`${TD} text-amber-800`}>{f.horasEst ? numHoja(f.horasEst) : ''}</td>
                    <td className={TD}><Par a={numHoja(f.visorIni)} b={numHoja(f.visorFin)} /></td>
                    <td className={TD}>{numHoja(f.gastado)}</td>
                    <td className={TD}>{numHoja(f.rendimiento, 2)}</td>
                    <td className={TD}>{numHoja(f.rpm, 0)}</td>
                  </>
                )}
                <td className={`${TD} font-medium`}>
                  {f.suministro > 0 ? numHoja(f.suministro) : ''}
                  {f.operador ? <span className="block truncate text-[10px] font-normal text-slate-600">{f.operador.split(' ')[0]}</span> : null}
                </td>
                <td className={TD}>{f.caudalIni === null && f.caudalFin === null ? '' : <Par a={numHoja(f.caudalIni)} b={numHoja(f.caudalFin)} />}</td>
                <td className="px-0.5 py-1 text-center"><Marca senal={f.senal} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-totales-hoja>
              <td className="sticky bottom-0 z-10 border-t border-slate-300 bg-slate-100 px-0.5 py-1 text-left text-[11px] font-medium text-slate-900">Total</td>
              <td className="sticky bottom-0 z-10 border-t border-slate-300 bg-slate-100 px-0.5 py-1 text-right text-[10px] text-slate-700">{t.dias} d</td>
              <td className={`sticky bottom-0 z-10 border-t border-slate-300 bg-slate-100 ${TD} font-medium`}>{numHoja(t.horas)}</td>
              <td className={`sticky bottom-0 z-10 border-t border-slate-300 bg-slate-100 ${TD} font-medium text-amber-800`}>{t.horasEst ? numHoja(t.horasEst) : ''}</td>
              <td className="sticky bottom-0 z-10 border-t border-slate-300 bg-slate-100" />
              <td className={`sticky bottom-0 z-10 border-t border-slate-300 bg-slate-100 ${TD} font-medium`}>{numHoja(t.gastado)}</td>
              <td className={`sticky bottom-0 z-10 border-t border-slate-300 bg-slate-100 ${TD} font-medium`}>{numHoja(t.rendimiento, 2)}</td>
              <td className="sticky bottom-0 z-10 border-t border-slate-300 bg-slate-100" />
              <td className={`sticky bottom-0 z-10 border-t border-slate-300 bg-slate-100 ${TD} font-medium`}>{numHoja(t.suministro)}</td>
              <td className="sticky bottom-0 z-10 border-t border-slate-300 bg-slate-100" />
              <td className="sticky bottom-0 z-10 border-t border-slate-300 bg-slate-100" />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
