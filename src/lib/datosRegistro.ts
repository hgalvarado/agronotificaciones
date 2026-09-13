import { createClient } from '@/lib/supabase/server'

export type Proveedor = { id: string; nombre: string; tipo: string }

export type ImplementoFisico = { id: string; codigo: string; descripcion: string }

type LoteTemporadaRow = {
  id: string
  temporada_id: string
  area_neta: number
  ciclo: number | null
  lotes:
    | { nomenclatura: string; nombre: string | null }
    | { nomenclatura: string; nombre: string | null }[]
    | null
}

export type TemporadaOpcion = { id: string; nombre: string; activa: boolean }

// Catálogos que necesita el formulario de labor. Se comparte entre la
// pantalla de alta y la de edición para que no se desincronicen.
export async function cargarCatalogosRegistro() {
  const supabase = await createClient()

  // Se traen TODAS las temporadas, no sólo la activa.
  //
  // «hay equipos que pueden trabajar en 2 temporadas diferentes esto se
  //  debe que hay lotes en los que se inicia temporada cuando hay otros
  //  lotes que estan todavia con la temporada anterior»
  //
  // Antes la lista de lotes se filtraba a la temporada activa y los lotes
  // que seguían en la anterior eran inalcanzables.
  const { data: temporadas } = await supabase
    .from('temporadas')
    .select('id, nombre, activa')
    .order('fecha_inicio', { ascending: false })

  const listaTemporadas = (temporadas as TemporadaOpcion[] | null) ?? []
  const temporadaActiva = listaTemporadas.find((t) => t.activa) ?? listaTemporadas[0] ?? null

  const [
    { data: labores },
    { data: tareasSap },
    { data: implementos },
    { data: lotesTemporada },
    { data: proveedores },
    { data: implementosFisicos },
    { data: vinculosFisicos },
  ] = await Promise.all([
      // Se piden todas las columnas (`*`) a propósito, no una lista: así
      // `usa_proveedor_plastico` y `usa_proveedor_manguera` llegan si la
      // migración 15 ya está corrida, y si no, la consulta sigue
      // funcionando en vez de fallar por una columna que no existe.
      supabase
        .from('labores')
        .select('*, labores_tareas(tarea_id), labores_implementos(implemento_id)')
        .eq('activo', true)
        .order('nombre'),
      supabase.from('tareas_sap').select('*').eq('activo', true).order('codigo'),
      supabase.from('implementos').select('*').eq('activo', true).order('nombre'),
      // Lotes de todas las temporadas: el formulario filtra por la que el
      // usuario elija, y así puede mezclar lotes de dos temporadas en la
      // misma labor si el equipo de verdad trabajó en las dos.
      supabase
        .from('lotes_temporada')
        .select('id, temporada_id, area_neta, ciclo, lotes(nomenclatura, nombre)')
        .eq('activo', true),
      // Los proveedores sólo existen a partir de la migración 12. Si no
      // está corrida, la consulta falla y el formulario simplemente no
      // muestra esos campos.
      supabase.from('proveedores').select('id, nombre, tipo').eq('activo', true).order('nombre'),
      // Los códigos físicos llegan con la migración 19. Si no está
      // corrida la consulta falla y el selector simplemente no aparece.
      supabase
        .from('implementos_fisicos')
        .select('id, codigo, descripcion')
        .eq('activo', true)
        .order('codigo'),
      // La vinculación va en su propia consulta y no incrustada en
      // `labores`: si la migración 19 no está corrida, así falla sólo
      // esta y el formulario sigue funcionando sin el selector, en vez
      // de quedarse sin labores.
      supabase.from('labores_implementos_fisicos').select('labor_id, implemento_fisico_id'),
    ])

  const lotes = ((lotesTemporada as LoteTemporadaRow[] | null) ?? [])
    .map((lt) => {
      const lote = Array.isArray(lt.lotes) ? lt.lotes[0] : lt.lotes
      return {
        lote_temporada_id: lt.id,
        temporada_id: lt.temporada_id,
        temporada_nombre: listaTemporadas.find((t) => t.id === lt.temporada_id)?.nombre ?? '',
        nomenclatura: lote?.nomenclatura ?? '—',
        nombre: lote?.nombre ?? null,
        area_neta: lt.area_neta,
        ciclo: lt.ciclo ?? 1,
      }
    })
    .sort((a, b) => a.nomenclatura.localeCompare(b.nomenclatura))

  return {
    temporadas: listaTemporadas,
    temporadaId: temporadaActiva?.id ?? null,
    labores: labores ?? [],
    tareasSap: tareasSap ?? [],
    implementos: implementos ?? [],
    lotes,
    proveedores: (proveedores as Proveedor[] | null) ?? [],
    implementosFisicos: (implementosFisicos as ImplementoFisico[] | null) ?? [],
    vinculosFisicos:
      (vinculosFisicos as { labor_id: string; implemento_fisico_id: string }[] | null) ?? [],
  }
}
