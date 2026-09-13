import { createClient } from '@/lib/supabase/server'
import {
  VinculacionLabores,
  type ImplementoFisicoOpcion,
  type LaborVinculada,
} from '@/components/admin/VinculacionLabores'

export default async function LaboresPage() {
  const supabase = await createClient()

  const [
    { data: labores },
    { data: categorias },
    { data: tareasSap },
    { data: implementos },
    sonda,
    { data: implementosFisicos },
    { data: vinculosFisicos },
  ] = await Promise.all([
      // `*` en vez de una lista de columnas: así `usa_proveedor_plastico`
      // y `usa_proveedor_manguera` llegan cuando la migración 15 está
      // corrida, y cuando no, la consulta no falla.
      supabase
        .from('labores')
        .select('*, labores_tareas(tarea_id), labores_implementos(implemento_id)')
        .order('nombre'),
      supabase.from('categorias_labor').select('*').eq('activo', true).order('nombre'),
      supabase.from('tareas_sap').select('*').eq('activo', true).order('codigo'),
      supabase.from('implementos').select('*').eq('activo', true).order('nombre'),
      // Sonda: pregunta por la columna a secas. Si la migración 15 no
      // está corrida devuelve error y los interruptores no se muestran,
      // en vez de mostrarlos y que el guardado falle. No se deduce de
      // las filas porque con el catálogo vacío no habría nada que mirar.
      supabase.from('labores').select('usa_proveedor_plastico').limit(1),
      // Los códigos físicos llegan con la migración 19. Van en su propia
      // consulta —y no incrustados en `labores`— para que, si la
      // migración no está corrida, falle sólo esto y la pantalla siga
      // sirviendo para lo demás.
      supabase
        .from('implementos_fisicos')
        .select('id, codigo, descripcion')
        .eq('activo', true)
        .order('codigo'),
      supabase.from('labores_implementos_fisicos').select('labor_id, implemento_fisico_id'),
    ])

  const soportaProveedores = !sonda.error

  // La vinculación se pega a cada labor aquí, en el servidor: el
  // componente ya recibe cada labor con sus códigos y no tiene que
  // recorrer la lista completa por fila.
  const porLabor = new Map<string, { implemento_fisico_id: string }[]>()
  for (const v of (vinculosFisicos as { labor_id: string; implemento_fisico_id: string }[] | null) ??
    []) {
    porLabor.set(v.labor_id, [
      ...(porLabor.get(v.labor_id) ?? []),
      { implemento_fisico_id: v.implemento_fisico_id },
    ])
  }

  const laboresConFisicos = ((labores as LaborVinculada[] | null) ?? []).map((l) => ({
    ...l,
    labores_implementos_fisicos: porLabor.get(l.id) ?? [],
  }))

  return (
    <div className="anim-aparecer mx-auto flex max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Vinculación de labores</h1>
        <p className="text-sm text-slate-400">
          Define qué tareas SAP, implementos y códigos físicos (ROMSR-01, ROMSR-08…) aplican a
          cada labor, a qué categoría pertenece y si pide proveedor de plástico o manguera. Para cargarlas en masa, usa el botón «Importar» de
          la pestaña Labores en Catálogos.
        </p>
      </div>

      <VinculacionLabores
        labores={laboresConFisicos}
        categorias={categorias ?? []}
        tareasSap={tareasSap ?? []}
        implementos={implementos ?? []}
        implementosFisicos={(implementosFisicos as ImplementoFisicoOpcion[] | null) ?? []}
        soportaProveedores={soportaProveedores}
      />
    </div>
  )
}
