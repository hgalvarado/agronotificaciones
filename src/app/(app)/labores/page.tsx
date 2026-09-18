import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ControlLabores, type TemporadaOpcion } from '@/components/registro/ControlLabores'
import type {
  CatalogosEdicion,
  LaborCompleta,
} from '@/components/registro/EditarLaborModal'
import { cargarCatalogosRegistro } from '@/lib/datosRegistro'
import { getPermisos, puede } from '@/lib/auth'

export default async function LaboresControlPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'labores', 'ver')) redirect('/tickets')

  const supabase = await createClient()

  // Los catálogos del formulario de edición son los MISMOS que los de la
  // captura: se reusa el cargador en vez de repetir las consultas, para
  // que editar no ofrezca opciones distintas de las que dejó capturar.
  const [catalogosRegistro, { data: equipos }, { data: temporadas }, { data: operadores }] =
    await Promise.all([
      cargarCatalogosRegistro(),
      supabase.from('equipos').select('*').order('codigo'),
      supabase
        .from('temporadas')
        .select('id, nombre, activa')
        .order('fecha_inicio', { ascending: false }),
      supabase.from('operadores').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    ])

  const labores = catalogosRegistro.labores as unknown as LaborCompleta[]

  const catalogosEdicion: CatalogosEdicion = {
    labores,
    tareasSap: catalogosRegistro.tareasSap,
    implementos: catalogosRegistro.implementos,
    implementosFisicos: catalogosRegistro.implementosFisicos,
    vinculosFisicos: catalogosRegistro.vinculosFisicos,
    proveedores: catalogosRegistro.proveedores,
    operadores: (operadores as CatalogosEdicion['operadores'] | null) ?? [],
    equipos: (equipos as CatalogosEdicion['equipos'] | null) ?? [],
    lotes: catalogosRegistro.lotes,
  }

  return (
    <div className="anim-aparecer flex flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Control de labores</h1>
        <p className="text-sm text-slate-400">
          Una línea por lote trabajado, con su tarea SAP y puesto de trabajo. Se escribe sobre la
          tabla y cada línea se edita sola: cambiarle la tarea a un lote no se la cambia a los demás
          lotes del mismo ticket.
        </p>
      </div>

      <ControlLabores
        temporadas={(temporadas as TemporadaOpcion[] | null) ?? []}
        catalogosEdicion={catalogosEdicion}
        puedeEditar={puede(permisos, 'labores', 'editar')}
        puedeEliminar={puede(permisos, 'labores', 'eliminar')}
        puedeEstandar={puede(permisos, 'permisos', 'editar')}
      />
    </div>
  )
}
