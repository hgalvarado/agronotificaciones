import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { Alerta } from '@/components/ui/Primitivos'
import { RotacionTabs } from '@/components/rotacion/RotacionTabs'
import {
  leerAvance,
  leerCatalogos,
  leerEstadisticas,
  leerPlan,
  leerPorLote,
  leerPorTipoSiembra,
  leerPorVariedad,
  leerPorZona,
} from '@/lib/rotacion/repositorio'
import { esFechaIso, hoyIso } from '@/lib/fechas'

type Temporada = { id: string; nombre: string; activa: boolean }

export default async function RotacionPage({
  searchParams,
}: {
  // En esta versión de Next `searchParams` es una promesa.
  searchParams: Promise<{ temporada?: string; corte?: string }>
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
      <div className="mx-auto max-w-4xl p-4 lg:p-6">
        <Alerta tono="ambar">No hay temporadas creadas. Ve a Catálogos → Temporadas.</Alerta>
      </div>
    )
  }

  // El corte por omisión es HOY en Honduras, que es lo que significa
  // «cómo vamos». Una fecha inventada en la dirección no tumba la
  // pantalla: se ignora y se usa hoy.
  const corte = esFechaIso(sp.corte) ? (sp.corte as string) : hoyIso()

  const [catalogos, plan, avance, estadisticas, porVariedad, porZona, porLote, porTipo] =
    await Promise.all([
      leerCatalogos(temporada.id),
      leerPlan(temporada.id),
      leerAvance(temporada.id, corte),
      leerEstadisticas(temporada.id, corte),
      leerPorVariedad(temporada.id, corte),
      leerPorZona(temporada.id, corte),
      leerPorLote(temporada.id, corte),
      leerPorTipoSiembra(temporada.id, corte),
    ])

  const faltaMigracion = Boolean(plan.error || avance.error || estadisticas.error)

  return (
    <div className="anim-aparecer mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Cultivos de rotación</h1>
          <p className="text-sm text-slate-400">
            Lo que se siembra entre ciclos para descansar el suelo: plan por lote, avance diario y
            costo por tipo de siembra.
          </p>
        </div>
        <Link
          href={`/controles/rotacion/reporte?temporada=${temporada.id}&hasta=${corte}`}
          className="inline-flex items-center rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
        >
          Ver reporte para gerencia
        </Link>
      </div>

      {faltaMigracion && (
        <Alerta tono="ambar">
          El módulo de rotación todavía no está instalado. Corre la migración 51 en el SQL Editor
          de Supabase.
        </Alerta>
      )}

      <RotacionTabs
        temporadas={lista}
        temporadaId={temporada.id}
        corte={corte}
        estadisticas={estadisticas.datos}
        plan={plan.datos}
        avance={avance.datos}
        porVariedad={porVariedad.datos}
        porZona={porZona.datos}
        porLote={porLote.datos}
        porTipo={porTipo.datos}
        lotes={catalogos.lotes}
        variedades={catalogos.variedades}
        puedeEditar={puede(permisos, 'rotacion', 'editar') || puede(permisos, 'rotacion', 'crear')}
        puedeEliminar={puede(permisos, 'rotacion', 'eliminar')}
      />
    </div>
  )
}
