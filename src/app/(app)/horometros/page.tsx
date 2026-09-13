import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { ControlHorometros } from '@/components/horometro/ControlHorometros'

export default async function HorometrosPage() {
  // Pantalla de revisión: sólo quien tenga el permiso de la pantalla.
  const permisos = await getPermisos()
  if (!puede(permisos, 'horometros', 'ver')) redirect('/tickets')

  const supabase = await createClient()
  const [{ data: equipos }, { data: operadores }] = await Promise.all([
    supabase.from('equipos').select('*').order('codigo'),
    supabase.from('operadores').select('*').eq('activo', true).order('nombre'),
  ])

  return (
    <div className="anim-aparecer flex flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Control de horómetros</h1>
        <p className="text-sm text-slate-400">
          Correlativo por equipo para detectar horas trabajadas sin notificar
        </p>
      </div>

      <ControlHorometros
        equipos={equipos ?? []}
        operadores={operadores ?? []}
        puedeEditar={puede(permisos, 'horometros', 'editar')}
        puedeEliminar={puede(permisos, 'horometros', 'eliminar')}
      />
    </div>
  )
}
