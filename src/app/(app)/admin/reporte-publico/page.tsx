import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, getUsuarioActual, puede } from '@/lib/auth'
import {
  ConfiguracionReportePublico,
  type ConfigInicial,
} from '@/components/admin/ConfiguracionReportePublico'
import type { EstadoTicketPublico, ProcesoTicket } from '@/lib/reporte-maquinaria/tipos'

type FilaConfig = {
  activo: boolean
  procesos: string[] | null
  estados: string[] | null
  todos_departamentos: boolean
  departamentos: string[] | null
}

export default async function ReportePublicoPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'reporte_publico', 'ver') && !puede(permisos, 'usuarios', 'ver')) {
    redirect('/admin/catalogos')
  }

  const supabase = await createClient()
  const usuario = await getUsuarioActual()

  const [configRes, deptosCatalogo, deptosUsados] = await Promise.all([
    supabase
      .from('reporte_publico_config')
      .select('activo, procesos, estados, todos_departamentos, departamentos')
      .eq('id', true)
      .maybeSingle(),
    supabase.from('departamentos').select('nombre').order('nombre'),
    // También los que ya están escritos en tickets: el catálogo y el
    // texto libre de las hojas viejas no siempre coinciden, y ocultar un
    // departamento que sí tiene tickets sería el error más caro aquí.
    supabase.from('tickets').select('departamento').not('departamento', 'is', null).limit(2000),
  ])

  const fila = configRes.data as FilaConfig | null

  const inicial: ConfigInicial = {
    activo: fila?.activo ?? false,
    procesos: (fila?.procesos ?? []) as ProcesoTicket[],
    estados: (fila?.estados ?? []) as EstadoTicketPublico[],
    todosDepartamentos: fila?.todos_departamentos ?? false,
    departamentos: fila?.departamentos ?? [],
  }

  const disponibles = [
    ...new Set([
      ...((deptosCatalogo.data as { nombre: string }[] | null) ?? []).map((d) => d.nombre),
      ...((deptosUsados.data as { departamento: string }[] | null) ?? []).map(
        (t) => t.departamento
      ),
      ...inicial.departamentos,
    ]),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'es'))

  return (
    <div className="anim-aparecer mx-auto flex max-w-4xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Reporte público de maquinaria
        </h1>
        <p className="text-sm text-slate-400">
          Qué puede ver quien entra sin usuario desde el botón del Login: qué procesos, qué
          estados de ticket y de qué departamentos.
        </p>
      </div>

      <ConfiguracionReportePublico
        inicial={inicial}
        departamentosDisponibles={disponibles}
        usuarioId={usuario?.id ?? null}
        puedeEditar={puede(permisos, 'reporte_publico', 'editar') || puede(permisos, 'usuarios', 'editar')}
        faltaMigracion={Boolean(configRes.error)}
      />
    </div>
  )
}
