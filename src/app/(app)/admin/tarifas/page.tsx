import { createClient } from '@/lib/supabase/server'
import {
  GestionTarifas,
  type PuestoTarifa,
  type TarifaFila,
  type TemporadaOpcion,
} from '@/components/admin/GestionTarifas'
import { Alerta } from '@/components/ui/Primitivos'
import { getPermisos, puede } from '@/lib/auth'

export default async function TarifasPage({
  searchParams,
}: {
  searchParams: Promise<{ temporada?: string }>
}) {
  const { temporada } = await searchParams
  const supabase = await createClient()
  const permisos = await getPermisos()

  if (!puede(permisos, 'tarifas', 'ver')) {
    return (
      <div className="mx-auto max-w-5xl p-4 lg:p-6">
        <Alerta tono="ambar">
          No tienes acceso a las tarifas. Pídeselo al Administrador desde Permisos.
        </Alerta>
      </div>
    )
  }

  const [{ data: temporadas }, { data: puestos }] = await Promise.all([
    supabase.from('temporadas').select('id, nombre, activa').order('fecha_inicio', {
      ascending: false,
    }),
    supabase
      .from('puestos_trabajo')
      .select('id, codigo, descripcion, operacion_sap')
      .eq('activo', true)
      .order('codigo'),
  ])

  const listaTemporadas = (temporadas as TemporadaOpcion[] | null) ?? []
  // Sin parámetro se abre la temporada activa; si no hay ninguna activa, la
  // más reciente. Así no hay que elegirla en cada visita.
  const temporadaId =
    temporada ?? listaTemporadas.find((t) => t.activa)?.id ?? listaTemporadas[0]?.id ?? null

  const { data: tarifas } = temporadaId
    ? await supabase
        .from('tarifas_puesto')
        .select(
          'id, puesto_trabajo_id, costo_hora, moneda, vigente_desde, vigente_hasta, comentario'
        )
        .eq('temporada_id', temporadaId)
        .order('vigente_desde', { ascending: false })
    : { data: [] }

  return (
    <div className="anim-aparecer mx-auto flex max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Tarifas</h1>
        <p className="text-sm text-slate-400">
          Costo por hora de cada puesto de trabajo. De aquí sale el dinero de los reportes de
          costos.
        </p>
      </div>

      <GestionTarifas
        temporadas={listaTemporadas}
        temporadaId={temporadaId}
        puestos={(puestos as PuestoTarifa[] | null) ?? []}
        tarifas={(tarifas as TarifaFila[] | null) ?? []}
        soloLectura={
          !puede(permisos, 'tarifas', 'editar') && !puede(permisos, 'tarifas', 'crear')
        }
      />
    </div>
  )
}
