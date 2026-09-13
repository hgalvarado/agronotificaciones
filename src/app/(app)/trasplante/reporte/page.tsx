import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { Alerta } from '@/components/ui/Primitivos'
import { IconChevronLeft } from '@/components/ui/Icons'
import { BotonImprimir } from '@/components/plan/BotonImprimir'
import { ReporteTrasplante } from '@/components/trasplante/ReporteTrasplante'
import {
  leerEstadisticas,
  leerPorSemana,
  leerPorVariedad,
  leerPorZona,
  leerSiembras,
} from '@/lib/trasplante/repositorio'
import { esFecha, hoyIso } from '@/lib/trasplante/validacion'

type Temporada = { id: string; nombre: string; activa: boolean }

export const dynamic = 'force-dynamic'

/**
 * Impresión horizontal y a tamaño fijo, igual que el reporte de
 * maquinaria: el navegador encoge la letra por su cuenta para meter más
 * filas, y un reporte que se audita no se lee con lupa.
 */
const IMPRESION = `
@media print {
  @page { size: letter landscape; margin: 8mm; }
  html, body { background: #fff; zoom: 1; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  .no-imprimir, .print\\:hidden { display: none !important; }
  .hoja-reporte { font-size: 9pt; line-height: 1.25; gap: 0.5rem; }
  .hoja-reporte table { width: 100%; font-size: 9pt; page-break-inside: auto; }
  .hoja-reporte thead { display: table-header-group; }
  .hoja-reporte tr { page-break-inside: avoid; break-inside: avoid; }
  .hoja-reporte .scroll-suave { overflow: visible !important; }
  /* Las secciones SÍ pueden partirse entre hojas. La hoja global las
     protege con \`break-inside: avoid\`, que aquí sobra: con sesenta
     siembras, obligar a que el bloque entero quepa deja media página en
     blanco y empuja todo a la siguiente. Lo que no se parte es una fila,
     y los títulos de columna se repiten. */
  .hoja-reporte section { break-inside: auto !important; page-break-inside: auto !important; }
}
`

export default async function ReporteTrasplantePage({
  searchParams,
}: {
  searchParams: Promise<{ temporada?: string; desde?: string; hasta?: string }>
}) {
  const permisos = await getPermisos()
  if (!puede(permisos, 'trasplante', 'ver')) redirect('/tickets')

  const sp = await searchParams
  const supabase = await createClient()

  const { data: temporadas } = await supabase
    .from('temporadas')
    .select('id, nombre, activa')
    .order('fecha_inicio', { ascending: false })

  const lista = (temporadas as Temporada[] | null) ?? []
  const temporada = lista.find((t) => t.id === sp.temporada) ?? lista.find((t) => t.activa) ?? lista[0]

  if (!temporada) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alerta tono="ambar">No hay temporadas creadas.</Alerta>
      </div>
    )
  }

  const hoy = hoyIso()
  const hasta = esFecha(sp.hasta) ? sp.hasta! : hoy
  const desdePedido = esFecha(sp.desde) ? sp.desde! : hasta
  const desde = desdePedido > hasta ? hasta : desdePedido

  // El acumulado va hasta la fecha de corte; el detalle diario, sólo del
  // rango. Comparar un plan recortado con lo ejecutado no diría nada.
  const [estadisticas, variedades, zonas, semanas, siembras] = await Promise.all([
    leerEstadisticas(temporada.id, hasta),
    leerPorVariedad(temporada.id, hasta),
    leerPorZona(temporada.id, hasta),
    leerPorSemana(temporada.id, hasta),
    leerSiembras(temporada.id, desde, hasta),
  ])

  const error =
    estadisticas.error ?? variedades.error ?? zonas.error ?? semanas.error ?? siembras.error

  return (
    <div className="mx-auto max-w-[1400px] p-4 lg:p-6 print:max-w-none print:p-0">
      <style dangerouslySetInnerHTML={{ __html: IMPRESION }} />

      <div className="no-imprimir mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/trasplante?temporada=${temporada.id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            <IconChevronLeft className="h-4 w-4" />
            Volver a trasplante
          </Link>
          <BotonImprimir />
        </div>

        <form
          className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[var(--shadow-card)]"
          action="/trasplante/reporte"
        >
          <input type="hidden" name="temporada" value={temporada.id} />
          <Etiqueta texto="Del">
            <input type="date" name="desde" defaultValue={desde} max={hoy} className={CLASE} />
          </Etiqueta>
          <Etiqueta texto="Al">
            <input type="date" name="hasta" defaultValue={hasta} max={hoy} className={CLASE} />
          </Etiqueta>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Ver
          </button>
        </form>
      </div>

      {error && (
        <div className="no-imprimir mb-3">
          <Alerta tono="ambar">
            Falta correr las migraciones 25 y 26 en el SQL Editor de Supabase.
          </Alerta>
        </div>
      )}

      <ReporteTrasplante
        temporada={temporada.nombre}
        desde={desde}
        hasta={hasta}
        estadisticas={estadisticas.datos}
        variedades={variedades.datos}
        zonas={zonas.datos}
        semanas={semanas.datos}
        siembras={siembras.datos}
      />
    </div>
  )
}

const CLASE =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10'

function Etiqueta({ texto, children }: { texto: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{texto}</span>
      {children}
    </label>
  )
}
