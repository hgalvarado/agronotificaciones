import { createClient } from '@/lib/supabase/server'
import { ControlCostos, type LineaCosto } from '@/components/costos/ControlCostos'
import { Alerta, BotonLink } from '@/components/ui/Primitivos'
import { getPermisos, puede } from '@/lib/auth'

/**
 * Tope de líneas que se traen de una vez. Cada labor produce dos líneas
 * (equipo e implemento), así que 4000 son unas 2000 labores: más que un mes
 * completo de operación. Si se pasa, se avisa en pantalla en vez de mentir
 * con totales incompletos.
 */
const TOPE = 4000

function haceUnMes() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

export default async function CostosPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const permisos = await getPermisos()

  if (!puede(permisos, 'costos', 'ver')) {
    return (
      <div className="mx-auto max-w-5xl p-4 lg:p-6">
        <Alerta tono="ambar">
          No tienes acceso a los costos. Pídeselo al Administrador desde Permisos.
        </Alerta>
      </div>
    )
  }

  const desde = params.desde ?? haceUnMes()
  const hasta = params.hasta ?? new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('v_costos_labores')
    .select('*')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })
    .limit(TOPE)

  const lineas = (data as LineaCosto[] | null) ?? []

  return (
    <div className="anim-aparecer mx-auto flex max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Costos</h1>
          <p className="text-sm text-slate-400">
            Horas notificadas por la tarifa vigente de cada puesto de trabajo.
          </p>
        </div>
        <BotonLink href="/admin/tarifas" variante="secundario" tamano="sm">
          Administrar tarifas
        </BotonLink>
      </div>

      {error ? (
        <Alerta>
          No se pudo consultar la vista de costos: {error.message}. Si dice que no existe
          «v_costos_labores», falta ejecutar la migración 11 en el SQL Editor de Supabase.
        </Alerta>
      ) : (
        <ControlCostos
          lineas={lineas}
          desde={desde}
          hasta={hasta}
          truncado={lineas.length >= TOPE}
        />
      )}
    </div>
  )
}
