import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { Alerta } from '@/components/ui/Primitivos'
import {
  ImportarHistorico,
  type CatalogosHistorico,
} from '@/components/admin/ImportarHistorico'

type LoteFila = {
  id: string
  lotes:
    | { nomenclatura: string; nombre: string | null }
    | { nomenclatura: string; nombre: string | null }[]
    | null
}

export default async function HistoricoPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'historico', 'ver') && !puede(permisos, 'usuarios', 'ver')) {
    redirect('/admin/catalogos')
  }

  const supabase = await createClient()

  const [
    { data: usuarios },
    { data: temporadas },
    { data: equipos },
    { data: operadores },
    { data: labores },
    { data: tareasSap },
    { data: implementos },
    { data: implementosFisicos },
    { data: lotes },
  ] = await Promise.all([
    supabase.from('perfiles').select('id, nombre, departamento').eq('activo', true).order('nombre'),
    supabase
      .from('temporadas')
      .select('id, nombre')
      .order('fecha_inicio', { ascending: false }),
    supabase.from('equipos').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    supabase.from('operadores').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    supabase.from('labores').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('tareas_sap').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    supabase.from('implementos').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    supabase
      .from('implementos_fisicos')
      .select('id, codigo, descripcion')
      .eq('activo', true)
      .order('codigo'),
    // TODOS los lotes de todas las temporadas: el histórico es de
    // temporadas viejas y filtrarlo a la activa dejaría fuera justo lo
    // que se quiere cargar.
    supabase
      .from('lotes_temporada')
      .select('id, lotes(nomenclatura, nombre)')
      .eq('activo', true),
  ])

  const catalogos: CatalogosHistorico = {
    usuarios: (usuarios as CatalogosHistorico['usuarios'] | null) ?? [],
    temporadas: (temporadas as CatalogosHistorico['temporadas'] | null) ?? [],
    equipos: (equipos as CatalogosHistorico['equipos'] | null) ?? [],
    operadores: (operadores as CatalogosHistorico['operadores'] | null) ?? [],
    labores: (labores as CatalogosHistorico['labores'] | null) ?? [],
    tareasSap: (tareasSap as CatalogosHistorico['tareasSap'] | null) ?? [],
    implementos: (implementos as CatalogosHistorico['implementos'] | null) ?? [],
    implementosFisicos:
      (implementosFisicos as CatalogosHistorico['implementosFisicos'] | null) ?? [],
    lotes: ((lotes as LoteFila[] | null) ?? [])
      .map((lt) => {
        const lote = Array.isArray(lt.lotes) ? lt.lotes[0] : lt.lotes
        return {
          id: lt.id,
          nomenclatura: lote?.nomenclatura ?? '—',
          nombre: lote?.nombre ?? null,
        }
      })
      .sort((a, b) => a.nomenclatura.localeCompare(b.nomenclatura, 'es', { numeric: true })),
  }

  // Un mismo lote puede estar en varias temporadas y aquí llegan todas
  // sus filas. Se avisa, porque si él escribe sólo «1002-110» en el
  // archivo se resuelve a la primera coincidencia.
  const repetidos = new Set<string>()
  const vistos = new Set<string>()
  for (const l of catalogos.lotes) {
    if (vistos.has(l.nomenclatura)) repetidos.add(l.nomenclatura)
    vistos.add(l.nomenclatura)
  }

  return (
    <div className="anim-aparecer mx-auto flex max-w-4xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Carga histórica</h1>
        <p className="text-sm text-slate-400">
          Sube el archivo de la plataforma anterior y se crean los tickets con sus horómetros y
          labores. No hay que crear nada a mano.
        </p>
      </div>

      {repetidos.size > 0 && (
        <Alerta tono="ambar">
          Hay lotes asignados a más de una temporada ({[...repetidos].slice(0, 5).join(', ')}
          {repetidos.size > 5 ? ` y ${repetidos.size - 5} más` : ''}). Si el archivo trae sólo la
          nomenclatura, la fila se resuelve a la primera coincidencia; para no equivocarte, en la
          columna del lote escribe «nomenclatura · nombre» tal como sale en la plantilla.
        </Alerta>
      )}

      <ImportarHistorico catalogos={catalogos} />
    </div>
  )
}
