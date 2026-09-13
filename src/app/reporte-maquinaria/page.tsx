/**
 * Visor público del reporte de maquinaria.
 *
 * Vive fuera de `(app)`: no tiene barra lateral, no pide sesión y no
 * comparte layout con la parte privada. Su único trabajo es DIBUJAR lo
 * que el servicio le da; ni valida, ni consulta, ni decide qué es
 * visible. Todo eso está en `src/lib/reporte-maquinaria`.
 */

import { EncabezadoReporte } from '@/components/reporte-maquinaria/EncabezadoReporte'
import { FiltrosReporte } from '@/components/reporte-maquinaria/FiltrosReporte'
import { TablaDetalle } from '@/components/reporte-maquinaria/TablaDetalle'
import { TablaHorometros } from '@/components/reporte-maquinaria/TablaHorometros'
import { FirmaNotificador } from '@/components/reporte-maquinaria/FirmaNotificador'
import { obtenerReporte } from '@/lib/reporte-maquinaria/servicio'
import { hoyIso, validarFiltros } from '@/lib/reporte-maquinaria/validacion'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Notificación de maquinaria · Agropecuaria Montelíbano',
}

/**
 * Impresión horizontal.
 *
 * `@page` no se puede limitar a una pantalla con una clase, así que la
 * regla se escribe aquí y sólo existe mientras esta página esté abierta.
 * Va después de la hoja global, así que gana sobre el `portrait` que usan
 * los demás reportes: diez columnas en vertical salen ilegibles.
 */
const IMPRESION = `
@media print {
  @page { size: letter landscape; margin: 8mm; }
  html, body {
    background: #fff;
    /* Nada de reescalados. El navegador encoge la letra por su cuenta
       para que quepan más filas, y un reporte que se audita con lupa no
       sirve: antes tres hojas legibles que una ilegible. */
    zoom: 1;
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
  }
  .no-imprimir, .print\\:hidden { display: none !important; }

  /* Tamaño FIJO, en puntos, que es la unidad del papel. Se declara aquí
     una vez y manda sobre cualquier tamaño de la pantalla: el reporte
     impreso siempre sale con la misma letra, tenga tres labores o
     sesenta. */
  .hoja-reporte { font-size: 10pt; line-height: 1.25; gap: 0.5rem; }
  .hoja-reporte table { width: 100%; font-size: 10pt; page-break-inside: auto; }
  /* El resumen del pie es un anexo, no la tabla que se audita: lleva su
     propio tamaño fijo para que las columnas del pie sigan cuadrando. */
  .tabla-horometros table { font-size: 7pt; }

  /* El encabezado se repite en cada hoja; una fila nunca se parte por la
     mitad entre dos páginas. */
  .hoja-reporte thead { display: table-header-group; }
  .hoja-reporte tfoot { display: table-footer-group; }
  .hoja-reporte tr { page-break-inside: avoid; break-inside: avoid; }

  /* El contenedor que permite deslizar la tabla en el celular no debe
     recortarla en papel: en papel no hay dedo que la deslice. */
  .hoja-reporte .scroll-suave { overflow: visible !important; }
}
`

export default async function ReporteMaquinariaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const filtros = validarFiltros(await searchParams)
  const reporte = await obtenerReporte(filtros)
  const hayDatos = reporte.detalle.length > 0 || reporte.horometros.length > 0

  return (
    <div className="min-h-dvh bg-slate-50 print:bg-white">
      <style dangerouslySetInnerHTML={{ __html: IMPRESION }} />

      <div className="mx-auto max-w-[1400px] p-4 lg:p-6 print:max-w-none print:p-0">
        <div className="no-imprimir mb-4 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[var(--shadow-card)]">
          <FiltrosReporte filtros={filtros} opciones={reporte.opciones} hoy={hoyIso()} />
        </div>

        <p className="no-imprimir mb-2 text-[11px] text-slate-400 sm:hidden">
          Las tablas se deslizan de lado con el dedo para ver el resto de las columnas.
        </p>

        <article className="hoja-reporte flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-card)] sm:p-6 print:rounded-none print:border-0 print:p-0 print:shadow-none">
          {/* En pantalla el membrete va aquí; al imprimir se esconde y lo
              dibuja el `thead` de la tabla, que es lo que se repite en
              cada hoja. */}
          <div className="print:hidden">
            <EncabezadoReporte
              fecha={filtros.fecha}
              temporada={reporte.configuracion.temporadaActiva}
            />
          </div>

          {reporte.aviso && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/10">
              {reporte.aviso}
            </p>
          )}

          <TablaDetalle
            filas={reporte.detalle}
            horometros={reporte.horometros}
            totalMz={reporte.totales.avanceMz}
            encabezado={
              <EncabezadoReporte
                fecha={filtros.fecha}
                temporada={reporte.configuracion.temporadaActiva}
              />
            }
          />

          {/* El pie va en dos bloques uno al lado del otro: el resumen de
              horómetros a la izquierda y la firma a la derecha. Apilados
              ocupaban media hoja de alto para nada y empujaban el reporte
              a una segunda página. */}
          {hayDatos && (
            <footer className="grid gap-5 border-t border-slate-200 pt-3 lg:grid-cols-[minmax(0,1fr)_180px] print:grid-cols-[minmax(0,1fr)_170px]">
              <TablaHorometros
                filas={reporte.horometros}
                totalHoras={reporte.totales.horasMaquina}
                totalHombre={reporte.totales.horasHombre}
              />

              <FirmaNotificador notificadores={reporte.notificadores} />
            </footer>
          )}
        </article>
      </div>
    </div>
  )
}
