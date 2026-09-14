import { createClient } from '@/lib/supabase/server'
import { Alerta } from '@/components/ui/Primitivos'
import { TableroAvance } from '@/components/dashboard/TableroAvance'
import type {
  OpcionLabor,
  OpcionLote,
  OpcionSimple,
  OpcionTemporada,
} from '@/lib/tablero/tipos'

type LoteRow = {
  id: string
  temporada_id: string
  zona_id: string | null
  ciclo: number | null
  lotes:
    | { nomenclatura: string; nombre: string | null }
    | { nomenclatura: string; nombre: string | null }[]
    | null
}

export default async function DashboardPage() {
  const supabase = await createClient()

  // El catálogo de procesos ya no se pide: el tablero no distingue entre
  // APS, LEV y CAT. Un lote es un lote y su plan es el área que hay que
  // recorrer, sea cual sea el proceso que la recorra.
  const [
    { data: temporadas },
    { data: zonas },
    { data: lotes },
    { data: labores },
    { data: categorias },
  ] = await Promise.all([
    supabase
      .from('temporadas')
      .select('id, nombre, activa')
      .order('fecha_inicio', { ascending: false }),
    supabase.from('zonas').select('id, nombre').eq('activo', true).order('nombre'),
    supabase
      .from('lotes_temporada')
      .select('id, temporada_id, zona_id, ciclo, lotes(nomenclatura, nombre)')
      .eq('activo', true),
    supabase
      .from('labores')
      .select('id, nombre, categoria_labor_id')
      .eq('activo', true)
      .order('nombre'),
    supabase.from('categorias_labor').select('id, nombre').eq('activo', true).order('nombre'),
  ])

  const listaTemporadas = (temporadas as OpcionTemporada[] | null) ?? []

  if (listaTemporadas.length === 0) {
    return (
      <div className="mx-auto max-w-4xl p-4 lg:p-6">
        <Alerta tono="ambar">No hay temporadas creadas. Ve a Catálogos → Temporadas.</Alerta>
      </div>
    )
  }

  const opcionesLote: OpcionLote[] = ((lotes as LoteRow[] | null) ?? [])
    .map((lt) => {
      const lote = Array.isArray(lt.lotes) ? lt.lotes[0] : lt.lotes
      const ut = lote?.nomenclatura ?? '—'
      return {
        id: lt.id,
        temporada_id: lt.temporada_id,
        zona_id: lt.zona_id,
        ciclo: lt.ciclo,
        etiqueta: lote?.nombre ? `${ut} · ${lote.nombre}` : ut,
      }
    })
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }))

  return (
    <div className="anim-aparecer mx-auto flex max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Avance</h1>
        <p className="text-sm text-slate-400">
          Manzanas trabajadas y gasto contra el área planificada. Filtra por zona, ciclo, lote,
          labor, categoría o fechas, y agrupa el detalle como lo necesites.
        </p>
      </div>

      <TableroAvance
        temporadas={listaTemporadas}
        zonas={(zonas as OpcionSimple[] | null) ?? []}
        lotes={opcionesLote}
        labores={(labores as OpcionLabor[] | null) ?? []}
        categorias={(categorias as OpcionSimple[] | null) ?? []}
      />
    </div>
  )
}
