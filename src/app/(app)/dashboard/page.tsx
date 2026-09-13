import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { Alerta } from '@/components/ui/Primitivos'
import {
  TableroAvance,
  type OpcionLabor,
  type OpcionLote,
  type OpcionProceso,
  type OpcionSimple,
  type OpcionTemporada,
} from '@/components/dashboard/TableroAvance'

type LoteRow = {
  id: string
  temporada_id: string
  zona_id: string | null
  lotes:
    | { nomenclatura: string; nombre: string | null }
    | { nomenclatura: string; nombre: string | null }[]
    | null
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const permisos = await getPermisos()

  const [
    { data: temporadas },
    { data: procesos, error: errorProcesos },
    { data: zonas },
    { data: lotes },
    { data: labores },
    { data: categorias },
  ] = await Promise.all([
    supabase
      .from('temporadas')
      .select('id, nombre, activa')
      .order('fecha_inicio', { ascending: false }),
    supabase
      .from('procesos_sap')
      .select('id, codigo, nombre')
      .eq('activo', true)
      .order('orden'),
    supabase.from('zonas').select('id, nombre').eq('activo', true).order('nombre'),
    supabase
      .from('lotes_temporada')
      .select('id, temporada_id, zona_id, lotes(nomenclatura, nombre)')
      .eq('activo', true),
    supabase
      .from('labores')
      .select('id, nombre, categoria_labor_id')
      .eq('activo', true)
      .order('nombre'),
    supabase.from('categorias_labor').select('id, nombre').eq('activo', true).order('nombre'),
  ])

  if (errorProcesos) {
    return (
      <div className="mx-auto max-w-4xl p-4 lg:p-6">
        <Alerta>
          No se pudo leer el catálogo de procesos: {errorProcesos.message}. Si dice que no existe
          «procesos_sap», falta ejecutar la migración 13 en el SQL Editor de Supabase.
        </Alerta>
      </div>
    )
  }

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
        etiqueta: lote?.nombre ? `${ut} · ${lote.nombre}` : ut,
      }
    })
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }))

  // Los permisos se resuelven en el servidor y bajan como una lista de
  // códigos: el componente del tablero es de cliente y no puede leer la
  // sesión ni la tabla de permisos.
  const permisosPlan = ['plan_aps'].filter(
    (p) => puede(permisos, p, 'ver') || puede(permisos, 'plan', 'ver')
  )

  return (
    <div className="anim-aparecer mx-auto flex max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Avance</h1>
        <p className="text-sm text-slate-400">
          Manzanas trabajadas contra el área planificada. Filtra por lote, zona, labor, categoría o
          fechas y todo el tablero se recalcula.
        </p>
      </div>

      <TableroAvance
        temporadas={listaTemporadas}
        procesos={(procesos as OpcionProceso[] | null) ?? []}
        zonas={(zonas as OpcionSimple[] | null) ?? []}
        lotes={opcionesLote}
        labores={(labores as OpcionLabor[] | null) ?? []}
        categorias={(categorias as OpcionSimple[] | null) ?? []}
        permisosPlan={permisosPlan}
      />
    </div>
  )
}
