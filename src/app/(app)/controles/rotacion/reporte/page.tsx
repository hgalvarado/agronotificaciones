import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { Alerta } from '@/components/ui/Primitivos'
import { IconChevronLeft } from '@/components/ui/Icons'
import { BotonImprimir } from '@/components/plan/BotonImprimir'
import { ReporteRotacion } from '@/components/rotacion/ReporteRotacion'
import {
  leerAvance,
  leerEstadisticas,
  leerPorLote,
  leerPorTipoSiembra,
  leerPorVariedad,
  leerPorZona,
} from '@/lib/rotacion/repositorio'
import { esFechaIso, hoyIso } from '@/lib/fechas'

type Temporada = { id: string; nombre: string; activa: boolean }

export const dynamic = 'force-dynamic'

/**
 * Impresión horizontal y a tamaño fijo, igual que los otros dos reportes
 * de gerencia: el navegador encoge la letra por su cuenta para meter más
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
  /* Las gráficas SÍ se imprimen: son SVG y van con
     \`print-color-adjust: exact\` en su propio componente. Lo que no puede
     partirse es una figura por la mitad. */
  .hoja-reporte figure { break-inside: avoid; page-break-inside: avoid; }
  /* Las secciones sí pueden partirse entre hojas: con sesenta líneas de
     avance, obligar a que el bloque entero quepa deja media página en
     blanco y empuja todo a la siguiente. Lo que no se parte es una fila,
     y los títulos de columna se repiten. */
  .hoja-reporte section { break-inside: auto !important; page-break-inside: auto !important; }
}
`

export default async function ReporteRotacionPage({
  searchParams,
}: {
  // En esta versión de Next `searchParams` es una promesa.
  searchParams: Promise<{ temporada?: string; desde?: string; hasta?: string }>
}) {
  const permisos = await getPermisos()
  if (!puede(permisos, 'rotacion', 'ver')) redirect('/tickets')

  const sp = await searchParams
  const supabase = await createClient()

  const { data: temporadas } = await supabase
    .from('temporadas')
    .select('id, nombre, activa')
    .order('fecha_inicio', { ascending: false })

  const lista = (temporadas as Temporada[] | null) ?? []
  const temporada =
    lista.find((t) => t.id === sp.temporada) ?? lista.find((t) => t.activa) ?? lista[0]

  if (!temporada) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alerta tono="ambar">No hay temporadas creadas.</Alerta>
      </div>
    )
  }

  const hoy = hoyIso()
  const hasta = esFechaIso(sp.hasta) ? (sp.hasta as string) : hoy
  const desdePedido = esFechaIso(sp.desde) ? (sp.desde as string) : hasta
  // Un rango al revés no es un error del que haya que avisar: se entiende
  // como «ese día» y el reporte sale igual.
  const desde = desdePedido > hasta ? hasta : desdePedido

  // El acumulado va hasta la FECHA DE CORTE; el detalle diario, sólo del
  // rango. Son dos preguntas distintas: «cómo vamos» y «qué se hizo estos
  // días».
  const [estadisticas, porVariedad, porZona, porLote, porTipo, avance] = await Promise.all([
    leerEstadisticas(temporada.id, hasta),
    leerPorVariedad(temporada.id, hasta),
    leerPorZona(temporada.id, hasta),
    leerPorLote(temporada.id, hasta),
    leerPorTipoSiembra(temporada.id, hasta),
    leerAvance(temporada.id, hasta),
  ])

  // El detalle del rango se recorta aquí y no en otra consulta: lo de
  // arriba ya trajo todo hasta el corte, y pedirlo dos veces sólo
  // serviría para que las dos respuestas pudieran discrepar.
  const delRango = avance.datos.filter((f) => f.fecha >= desde && f.fecha <= hasta)

  const error =
    estadisticas.error ?? porVariedad.error ?? porZona.error ?? porLote.error ?? avance.error

  return (
    <div className="mx-auto max-w-[1400px] p-4 lg:p-6 print:max-w-none print:p-0">
      <style dangerouslySetInnerHTML={{ __html: IMPRESION }} />

      <div className="no-imprimir mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/controles/rotacion?temporada=${temporada.id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            <IconChevronLeft className="h-4 w-4" />
            Volver a cultivos de rotación
          </Link>
          <BotonImprimir />
        </div>

        <form
          className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[var(--shadow-card)]"
          action="/controles/rotacion/reporte"
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
            Falta correr la migración 51 en el SQL Editor de Supabase.
          </Alerta>
        </div>
      )}

      <ReporteRotacion
        temporada={temporada.nombre}
        desde={desde}
        hasta={hasta}
        estadisticas={estadisticas.datos}
        avance={delRango}
        porVariedad={porVariedad.datos}
        porZona={porZona.datos}
        porLote={porLote.datos}
        porTipo={porTipo.datos}
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
