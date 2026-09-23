import { redirect } from 'next/navigation'
import { getPermisos, puede } from '@/lib/auth'
import { Alerta } from '@/components/ui/Primitivos'
import { TelecomTabs } from '@/components/telecom/TelecomTabs'
import {
  leerAlertas,
  leerAsignaciones,
  leerCatalogos,
  leerEquipos,
  leerLineas,
} from '@/lib/telecom/repositorio'

export default async function TelecomPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'telecom', 'ver')) redirect('/tickets')

  const [lineas, equipos, asignaciones, alertas, catalogos] = await Promise.all([
    leerLineas(),
    leerEquipos(),
    leerAsignaciones(),
    leerAlertas(),
    leerCatalogos(),
  ])

  const faltaMigracion = Boolean(lineas.error || equipos.error || asignaciones.error)

  return (
    <div className="anim-aparecer mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Telecomunicaciones</h1>
        <p className="text-sm text-slate-400">
          Líneas, equipos y a quién está entregado cada uno. El acta de entrega sale de aquí.
        </p>
      </div>

      {faltaMigracion ? (
        <Alerta tono="ambar">
          El módulo de telecomunicaciones todavía no está instalado. Corre la migración 47 en el
          SQL Editor de Supabase.
        </Alerta>
      ) : (
        <TelecomTabs
          alertas={alertas.datos}
          lineas={lineas.datos}
          equipos={equipos.datos}
          asignaciones={asignaciones.datos}
          planes={catalogos.planes}
          personal={catalogos.personal}
          centrosCosto={catalogos.centrosCosto}
          departamentos={catalogos.departamentos}
          puestos={catalogos.puestos}
          puedeEditar={puede(permisos, 'telecom', 'editar') || puede(permisos, 'telecom', 'crear')}
          puedeEliminar={puede(permisos, 'telecom', 'eliminar')}
        />
      )}
    </div>
  )
}
