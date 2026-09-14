import { createClient } from '@/lib/supabase/server'
import { GestionContadores, type EquipoOpcion } from '@/components/admin/GestionContadores'
import { Alerta } from '@/components/ui/Primitivos'
import { getPermisos, puede } from '@/lib/auth'

export default async function ContadoresPage() {
  const supabase = await createClient()
  const permisos = await getPermisos()

  if (!puede(permisos, 'catalogos', 'ver')) {
    return (
      <div className="mx-auto max-w-5xl p-4 lg:p-6">
        <Alerta tono="ambar">
          No tienes acceso a los catálogos. Pídeselo al Administrador desde Permisos.
        </Alerta>
      </div>
    )
  }

  // `contador_sap` llega con la migración 38. Se pide con `*` para que,
  // si todavía no está corrida, la pantalla se abra igual y sea el aviso
  // del historial —no un error de columna— el que lo explique.
  const { data } = await supabase.from('equipos').select('*').eq('activo', true).order('codigo')

  const equipos: EquipoOpcion[] = (data ?? []).map((e) => ({
    id: e.id as string,
    codigo: e.codigo as string,
    contador_sap: (e.contador_sap as string | null) ?? null,
  }))

  return (
    <div className="anim-aparecer mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Contadores de horómetro
        </h1>
        <p className="text-sm text-slate-400">
          Cada vez que se cambia un tablero el contador arranca de cero. Registrar el cambio aquí
          es lo que evita que ese salto salga en <strong>Horómetros</strong> como un desfase de
          miles de horas: el comparativo rompe la cadena en la fecha que digas y empieza limpio.
        </p>
      </div>

      <GestionContadores
        equipos={equipos}
        puedeEditar={puede(permisos, 'catalogos', 'editar') || puede(permisos, 'catalogos', 'crear')}
        puedeEliminar={puede(permisos, 'catalogos', 'eliminar')}
      />
    </div>
  )
}
