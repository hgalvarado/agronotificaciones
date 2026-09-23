'use client'

/**
 * El acta, a la vista antes de decidir qué hacer con ella.
 *
 * Antes el botón bajaba el PDF de golpe: si faltaba el correo o el
 * puesto había que abrir la descarga, verlo, cerrar, corregir en la
 * tabla y volver a bajarlo. Ahora se ve primero y desde aquí se imprime
 * —con la impresora del navegador, que es la que la gente ya sabe usar—
 * o se baja el archivo para archivarlo o mandarlo por correo.
 *
 * Lo que se ve es lo mismo que dice el PDF porque las dos cosas salen de
 * `bloquesActa`. Aquí sólo está la maquetación en pantalla y las reglas
 * de impresión: al imprimir desaparece la aplicación entera y queda la
 * hoja sola, sin encabezados del navegador que no son del acta.
 */

import { Boton } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { descargar } from '@/lib/hojas'
import {
  bloquesActa,
  construirActa,
  DECLARACION,
  ENCABEZADO,
  FIRMAS,
  nombreActa,
} from '@/lib/telecom/acta'
import type { FilaAsignacion } from '@/lib/telecom/tipos'

/**
 * Sólo la hoja se imprime.
 *
 * `visibility` y no `display: none`: ocultando con `display` se pierde
 * la posición de la hoja y sale corrida en el papel. Con `visibility` el
 * navegador conserva la maqueta, se apaga todo y se vuelve a encender
 * únicamente el acta, anclada arriba a la izquierda.
 */
const IMPRESION = `
@media print {
  @page { size: letter; margin: 14mm; }
  body * { visibility: hidden !important; }
  #acta-imprimible, #acta-imprimible * { visibility: visible !important; }
  #acta-imprimible {
    position: absolute; left: 0; top: 0; width: 100%;
    box-shadow: none !important; border: 0 !important; padding: 0 !important;
  }
  /* Un correo corporativo o un puesto largo se PARTEN, no se recortan:
     un acta con el correo cortado no sirve para reclamar nada. */
  #acta-imprimible, #acta-imprimible * {
    overflow: visible !important;
    text-overflow: clip !important;
    white-space: normal !important;
    word-wrap: break-word !important;
    overflow-wrap: anywhere !important;
  }
  .no-imprimir { display: none !important; }
}
`

export function ActaPreview({
  asignacion,
  onCerrar,
}: {
  asignacion: FilaAsignacion | null
  onCerrar: () => void
}) {
  if (!asignacion) return null
  return <Contenido key={asignacion.id} asignacion={asignacion} onCerrar={onCerrar} />
}

function Contenido({
  asignacion,
  onCerrar,
}: {
  asignacion: FilaAsignacion
  onCerrar: () => void
}) {
  const b = bloquesActa(asignacion)

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo="Acta de entrega"
      pie={
        <div className="no-imprimir flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar}>
            Cerrar
          </Boton>
          <Boton variante="secundario" className="flex-1" onClick={() => window.print()}>
            Imprimir
          </Boton>
          <Boton
            className="flex-1"
            onClick={() => descargar(construirActa(asignacion), nombreActa(asignacion))}
          >
            Descargar PDF
          </Boton>
        </div>
      }
    >
      <style dangerouslySetInnerHTML={{ __html: IMPRESION }} />

      <div
        id="acta-imprimible"
        className="flex flex-col gap-5 bg-white p-4 text-slate-900 ring-1 ring-slate-200 print:ring-0"
      >
        {/* ---------------------------- Membrete ---------------------------- */}
        <header className="flex flex-col items-center gap-0.5 border-b border-slate-300 pb-3 text-center">
          <p className="text-lg font-bold tracking-tight">{ENCABEZADO.empresa}</p>
          <p className="text-base font-bold">{ENCABEZADO.documento}</p>
          <p className="text-sm text-slate-500">{ENCABEZADO.unidad}</p>
        </header>

        <p className="text-right text-sm text-slate-500">Fecha de entrega: {b.fecha}</p>

        <Bloque titulo="Datos del colaborador" filas={b.colaborador} />
        <Bloque titulo="Datos del equipo entregado" filas={b.equipo} />

        {/* --------------------------- Accesorios --------------------------- */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Accesorios entregados
          </h3>
          {b.accesorios.length === 0 ? (
            <p className="text-sm text-slate-400">Ninguno.</p>
          ) : (
            <ul className="grid gap-1 sm:grid-cols-2">
              {b.accesorios.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm">
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center border border-slate-400 text-[9px] font-bold leading-none">
                    X
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          )}
        </section>

        {b.devolucion && (
          <p className="bg-slate-100 px-3 py-2.5 text-sm font-bold">{b.devolucion}</p>
        )}

        {b.observaciones && (
          <section className="flex flex-col gap-1">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Observaciones
            </h3>
            <p className="text-sm">{b.observaciones}</p>
          </section>
        )}

        <p className="text-xs leading-relaxed text-slate-600">{DECLARACION}</p>

        {/* ----------------------------- Firmas ----------------------------- */}
        <div className="grid grid-cols-2 gap-8 pt-14">
          {FIRMAS.map((rotulo) => (
            <div key={rotulo} className="flex flex-col items-center gap-1">
              <span className="text-base tracking-widest text-slate-400">
                _________________________
              </span>
              <span className="text-xs font-bold text-slate-700">{rotulo}</span>
            </div>
          ))}
        </div>

        <footer className="flex justify-between border-t border-slate-200 pt-2 text-[10px] text-slate-400">
          <span>Acta {b.folio}</span>
          <span>
            {ENCABEZADO.empresa} · {ENCABEZADO.unidad}
          </span>
        </footer>
      </div>
    </Modal>
  )
}

function Bloque({ titulo, filas }: { titulo: string; filas: [string, string][] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{titulo}</h3>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {filas.map(([etiqueta, valor]) => (
          <div key={etiqueta} className="flex gap-2 text-sm">
            <dt className="w-32 shrink-0 text-slate-500">{etiqueta}:</dt>
            <dd className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{valor}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
