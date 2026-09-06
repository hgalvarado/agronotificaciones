import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getPerfilActual } from '@/lib/auth'
import { TabsCatalogos, type PestanaCatalogo } from '@/components/catalogos/TabsCatalogos'

export default async function CatalogosPage() {
  const supabase = await createClient()
  const { rol } = await getPerfilActual()
  const soloLectura = rol?.codigo === 'DIGITADOR' // el digitador ve pero no edita catálogos generales

  const [
    { data: zonas },
    { data: equipos },
    { data: implementos },
    { data: operadores },
    { data: categoriasLabor },
    { data: labores },
    { data: tareasSap },
    { data: temporadas },
    { data: lotes },
  ] = await Promise.all([
    supabase.from('zonas').select('*').order('nombre'),
    supabase.from('equipos').select('*').order('codigo'),
    supabase.from('implementos').select('*').order('nombre'),
    supabase.from('operadores').select('*').order('nombre'),
    supabase.from('categorias_labor').select('*').order('nombre'),
    supabase.from('labores').select('*').order('nombre'),
    supabase.from('tareas_sap').select('*').order('codigo'),
    supabase.from('temporadas').select('*').order('nombre'),
    supabase.from('lotes').select('*').order('nomenclatura'),
  ])

  const pestanas: PestanaCatalogo[] = [
    {
      key: 'zonas',
      label: 'Zonas',
      tabla: 'zonas',
      campos: [
        { key: 'nombre', label: 'Zona', tipo: 'text', requerido: true },
        { key: 'responsable', label: 'Responsable', tipo: 'text' },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: zonas ?? [],
    },
    {
      key: 'equipos',
      label: 'Equipos',
      tabla: 'equipos',
      campos: [
        { key: 'codigo', label: 'Código', tipo: 'text', requerido: true },
        { key: 'nombre', label: 'Nombre', tipo: 'text', requerido: true },
        { key: 'distrito', label: 'Distrito', tipo: 'text' },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: equipos ?? [],
    },
    {
      key: 'implementos',
      label: 'Implementos',
      tabla: 'implementos',
      campos: [
        { key: 'codigo', label: 'Código', tipo: 'text', requerido: true },
        { key: 'nombre', label: 'Nombre', tipo: 'text', requerido: true },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: implementos ?? [],
    },
    {
      key: 'operadores',
      label: 'Operadores',
      tabla: 'operadores',
      campos: [
        { key: 'codigo', label: 'Código', tipo: 'text' },
        { key: 'nombre', label: 'Nombre', tipo: 'text', requerido: true },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: operadores ?? [],
    },
    {
      key: 'categorias_labor',
      label: 'Categorías de labor',
      tabla: 'categorias_labor',
      campos: [
        { key: 'nombre', label: 'Categoría', tipo: 'text', requerido: true },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: categoriasLabor ?? [],
    },
    {
      key: 'labores',
      label: 'Labores',
      tabla: 'labores',
      campos: [
        { key: 'nombre', label: 'Labor', tipo: 'text', requerido: true },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: labores ?? [],
    },
    {
      key: 'tareas_sap',
      label: 'Tareas SAP',
      tabla: 'tareas_sap',
      campos: [
        { key: 'codigo', label: 'Código', tipo: 'text', requerido: true },
        { key: 'nombre', label: 'Nombre', tipo: 'text', requerido: true },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: tareasSap ?? [],
    },
    {
      key: 'temporadas',
      label: 'Temporadas',
      tabla: 'temporadas',
      campos: [
        { key: 'nombre', label: 'Temporada', tipo: 'text', requerido: true },
        { key: 'fecha_inicio', label: 'Inicio', tipo: 'text', requerido: true },
        { key: 'fecha_fin', label: 'Fin', tipo: 'text', requerido: true },
        { key: 'activa', label: 'Activa', tipo: 'checkbox' },
      ],
      filas: temporadas ?? [],
    },
    {
      key: 'lotes',
      label: 'Lotes',
      tabla: 'lotes',
      campos: [
        { key: 'nomenclatura', label: 'Nomenclatura', tipo: 'text', requerido: true },
        { key: 'nombre', label: 'Nombre', tipo: 'text' },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: lotes ?? [],
    },
  ]

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-900">Catálogos</h1>
        {rol?.codigo === 'ADMIN' && (
          <Link href="/admin/permisos" className="text-sm text-emerald-700 underline">
            Permisos por rol
          </Link>
        )}
      </div>
      {soloLectura && (
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
          Tu rol permite crear algunos registros de catálogo, pero no editar los existentes.
        </p>
      )}
      <TabsCatalogos pestanas={pestanas} soloLectura={soloLectura} />
    </div>
  )
}
