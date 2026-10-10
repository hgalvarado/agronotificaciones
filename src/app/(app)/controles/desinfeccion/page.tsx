import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMisZonas, getPermisos, getReglas, getUsuarioActual, puede } from '@/lib/auth'
import { aplanarReglas } from '@/lib/permisos/clientABAC'
import { DesinfeccionTabs } from '@/components/desinfeccion/DesinfeccionTabs'
import type { CatalogosDesinfeccion } from '@/lib/desinfeccion/tipos'

export default async function DesinfeccionPage() {
  const permisos = await getPermisos()
  // Las reglas enteras y no su resultado: las cuadrículas deciden Editar
  // y Eliminar fila por fila, con el dueño y la zona de cada una.
  const [reglas, usuario, misZonas] = await Promise.all([
    getReglas(),
    getUsuarioActual(),
    getMisZonas(),
  ])
  if (!puede(permisos, 'desinfeccion', 'ver')) redirect('/tickets')

  const supabase = await createClient()

  // Los LOTES no se traen aquí: son miles y dependen de la temporada que
  // se esté mirando, que se cambia sin recargar la página. Los pide el
  // propio módulo cuando hace falta.
  const [
    { data: temporadas },
    { data: zonas },
    { data: turnos },
    { data: estaciones },
    { data: variedades },
    { data: materiales },
    { data: operadores },
    { data: equipos },
    { data: implementos },
  ] = await Promise.all([
    supabase.from('temporadas').select('id, nombre, activa').order('fecha_inicio', { ascending: false }),
    // Ya viene recortada por las zonas asignadas: lo hace la RLS de la
    // migración 41, así que aquí no hay filtro que repetir.
    supabase.from('zonas').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('turnos').select('id, codigo, zona_id').eq('activo', true).order('codigo'),
    // Con su zona desde la 60: es lo que permite recortar el selector.
    supabase.from('estaciones_riego').select('id, nombre, zona_id').eq('activo', true).order('nombre'),
    supabase.from('variedades').select('id, nombre').eq('activo', true).order('nombre'),
    // Con ingrediente activo y concentración desde la 61: es lo que deja
    // comparar dos productos que se llaman distinto y hacen lo mismo.
    supabase
      .from('materiales')
      .select('id, codigo, descripcion, ingrediente_activo, concentracion')
      .eq('activo', true)
      .order('codigo'),
    // Con su código y su marca de jornal: el selector de cuadrilla sólo
    // ofrece jornales, y los enseña como «código - nombre».
    supabase
      .from('operadores')
      .select('id, codigo, nombre, es_jornal')
      .eq('activo', true)
      .order('nombre'),
    supabase.from('equipos').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    supabase.from('implementos').select('id, codigo, nombre').eq('activo', true).order('codigo'),
  ])

  const catalogos: CatalogosDesinfeccion = {
    temporadas: (temporadas ?? []) as CatalogosDesinfeccion['temporadas'],
    zonas: (zonas ?? []) as CatalogosDesinfeccion['zonas'],
    turnos: (turnos ?? []) as CatalogosDesinfeccion['turnos'],
    estaciones: (estaciones ?? []) as CatalogosDesinfeccion['estaciones'],
    variedades: (variedades ?? []) as CatalogosDesinfeccion['variedades'],
    materiales: (materiales ?? []) as CatalogosDesinfeccion['materiales'],
    operadores: (operadores ?? []) as CatalogosDesinfeccion['operadores'],
    equipos: (equipos ?? []) as CatalogosDesinfeccion['equipos'],
    implementos: (implementos ?? []) as CatalogosDesinfeccion['implementos'],
    lotes: [],
  }

  return (
    <div className="anim-aparecer mx-auto flex max-w-[1600px] flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Desinfección de suelo</h1>
        <p className="text-sm text-slate-400">
          Se planifica por lote, se ejecuta por <strong>turno de riego</strong> —preriego, lecturas
          y aplicación— y se cobra por lote: el químico y la cuadrilla se reparten entre los lotes
          del turno, y el acarreo entre las manzanas de su zona.
        </p>
      </div>

      <DesinfeccionTabs
        catalogos={catalogos}
        reglas={aplanarReglas(reglas)}
        usuarioId={usuario?.id ?? null}
        zonas={misZonas}
      />
    </div>
  )
}
