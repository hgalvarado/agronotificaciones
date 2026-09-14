import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { Alerta } from '@/components/ui/Primitivos'
import { TrasplanteTabs } from '@/components/trasplante/TrasplanteTabs'
import {
  leerAvanceUt,
  leerCatalogos,
  leerLiquidacion,
  leerPlan,
  leerRecepciones,
  leerSiembras,
} from '@/lib/trasplante/repositorio'
import { hoyIso, sumarDias } from '@/lib/fechas'

type Temporada = { id: string; nombre: string; activa: boolean }

/** Un mes atrás, que es lo que se mira normalmente al abrir. */
function haceUnMes() {
  return sumarDias(hoyIso(), -30)
}

export default async function TrasplantePage({
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
      <div className="mx-auto max-w-4xl p-4 lg:p-6">
        <Alerta tono="ambar">No hay temporadas creadas. Ve a Catálogos → Temporadas.</Alerta>
      </div>
    )
  }

  const desde = sp.desde ?? haceUnMes()
  const hasta = sp.hasta ?? hoyIso()

  const [catalogos, plan, siembras, avance, recepciones, liquidacion] = await Promise.all([
    leerCatalogos(temporada.id),
    leerPlan(temporada.id),
    leerSiembras(temporada.id, desde, hasta),
    leerAvanceUt(temporada.id, hasta),
    leerRecepciones(temporada.id),
    leerLiquidacion(temporada.id, null),
  ])

  const faltaMigracion = Boolean(plan.error || siembras.error || avance.error)
  const faltaRecepcion = Boolean(recepciones.error || liquidacion.error)

  return (
    <div className="anim-aparecer mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Trasplante</h1>
          <p className="text-sm text-slate-400">
            Plan de siembra, captura diaria y cuadre por unidad técnica. Proceso LEV.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/trasplante/reporte?temporada=${temporada.id}&desde=${desde}&hasta=${hasta}`}
            className="inline-flex items-center rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Reporte para gerencia
          </Link>
          {puede(permisos, 'trasplante', 'crear') && (
            <Link
              href={`/trasplante/nueva?temporada=${temporada.id}`}
              className="inline-flex items-center rounded-lg bg-brand-700 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
            >
              Nueva siembra
            </Link>
          )}
        </div>
      </div>

      {faltaMigracion && (
        <Alerta tono="ambar">
          El módulo de trasplante todavía no está instalado. Corre las migraciones 25 y 26 en el
          SQL Editor de Supabase.
        </Alerta>
      )}

      {!faltaMigracion && faltaRecepcion && (
        <Alerta tono="ambar">
          La recepción de plántulas todavía no está instalada. Corre la migración 27 en el SQL
          Editor de Supabase.
        </Alerta>
      )}

      <TrasplanteTabs
        temporadas={lista}
        temporadaId={temporada.id}
        desde={desde}
        hasta={hasta}
        avance={avance.datos}
        siembras={siembras.datos}
        plan={plan.datos}
        recepciones={recepciones.datos}
        liquidacion={liquidacion.datos}
        lotes={catalogos.lotes}
        variedades={catalogos.variedades}
        puedeEditar={puede(permisos, 'trasplante', 'editar') || puede(permisos, 'trasplante', 'crear')}
        puedeEliminar={puede(permisos, 'trasplante', 'eliminar')}
      />
    </div>
  )
}
