import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { ControlTurnosRiego } from '@/components/riego/ControlTurnosRiego'
import type { CatalogosRiego } from '@/lib/riego/tipos'

export default async function TurnosRiegoPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'turnos_riego', 'ver')) redirect('/tickets')

  const supabase = await createClient()

  // Los lotes NO se traen aquí: son miles y su saldo depende del turno
  // que se esté editando. Los pide el formulario a `fn_lotes_regables`
  // cuando hace falta, que es la única que sabe cuánto queda libre.
  const [
    { data: temporadas },
    { data: zonas },
    { data: planes },
    { data: variedades },
    { data: turnos },
    { data: estaciones },
  ] = await Promise.all([
    supabase.from('temporadas').select('id, nombre, activa').order('fecha_inicio', { ascending: false }),
    // `zonas` ya viene recortada por las zonas asignadas al usuario: la
    // RLS de la migración 41 lo hace sola, así que aquí no hay filtro.
    supabase.from('zonas').select('id, nombre, responsable').eq('activo', true).order('nombre'),
    // Llega con la migración 40. Si no está corrida, la pantalla se
    // abre igual y es el aviso del módulo —no un error de tabla— el que
    // lo explica.
    supabase.from('planes_nutricionales').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('variedades').select('id, nombre').eq('activo', true).order('nombre'),
    // Llegan con la 41. Vacíos, la pantalla cae a los campos de texto de
    // antes en vez de quedarse sin poder capturar.
    supabase.from('turnos').select('id, codigo, zona_id').eq('activo', true).order('codigo'),
    supabase.from('estaciones_riego').select('id, nombre').eq('activo', true).order('nombre'),
  ])

  const catalogos: CatalogosRiego = {
    temporadas: (temporadas ?? []) as CatalogosRiego['temporadas'],
    zonas: (zonas ?? []) as CatalogosRiego['zonas'],
    planes: (planes ?? []) as CatalogosRiego['planes'],
    variedades: (variedades ?? []) as CatalogosRiego['variedades'],
    turnos: (turnos ?? []) as CatalogosRiego['turnos'],
    estaciones: (estaciones ?? []) as CatalogosRiego['estaciones'],
  }

  return (
    <div className="anim-aparecer mx-auto flex max-w-[1600px] flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Turnos de riego</h1>
        <p className="text-sm text-slate-400">
          Un turno es una jornada de riego: una fecha de siembra, un plan nutricional y una zona,
          con los lotes que se riegan en ella. El área de cada lote no puede pasarse de lo
          planificado —o de lo sembrado, si el lote ya se terminó— y el{' '}
          <strong>DDT se recalcula solo</strong> cada día contra la hora de Honduras.
        </p>
      </div>

      <ControlTurnosRiego
        catalogos={catalogos}
        puedeCrear={puede(permisos, 'turnos_riego', 'crear')}
        puedeEditar={puede(permisos, 'turnos_riego', 'editar')}
        puedeEliminar={puede(permisos, 'turnos_riego', 'eliminar')}
      />
    </div>
  )
}
