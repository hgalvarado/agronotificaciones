import { createClient } from '@/lib/supabase/server'
import { leerTodo } from '@/lib/supabase/paginar'
import { ControlCostos, type LineaCosto } from '@/components/costos/ControlCostos'
import { Alerta, BotonLink } from '@/components/ui/Primitivos'
import { getPermisos, puede } from '@/lib/auth'
import { hoyIso, sumarDias } from '@/lib/fechas'

function haceUnMes() {
  return sumarDias(hoyIso(), -30)
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
  const hasta = params.hasta ?? hoyIso()

  // Sin tope. Antes se cortaba en 4000 líneas —unas 2000 labores— y un
  // rango de tres meses dejaba los totales cortos sin que se notara en
  // el número. Ahora se pide por tramos hasta agotar el rango, y
  // `completo` sólo viene en falso si se alcanza el freno de seguridad.
  const { datos: lineas, error, completo } = await leerTodo<LineaCosto>((d, h) =>
    supabase
      .from('v_costos_labores')
      .select('*')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: false })
      .order('detalle_id', { ascending: false })
      .range(d, h)
  )

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
          No se pudo consultar la vista de costos: {error}. Si dice que no existe
          «v_costos_labores», falta ejecutar la migración 11 en el SQL Editor de Supabase.
        </Alerta>
      ) : (
        <ControlCostos
          lineas={lineas}
          desde={desde}
          hasta={hasta}
          truncado={!completo}
        />
      )}
    </div>
  )
}
