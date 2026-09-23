/**
 * Lectura de telecomunicaciones (lado servidor).
 *
 * El único archivo del módulo que habla con Supabase para LEER en la
 * primera carga. Trae datos crudos o un error; no decide ni formatea.
 *
 * Todo se pide por tramos (`leerTodo`): son catálogos que crecen sin
 * parar —cada entrega deja una fila de historial— y un tope escrito a
 * mano volvería a esconder lo viejo el día que se cruce.
 */

import { createClient } from '@/lib/supabase/server'
import { leerTodo } from '@/lib/supabase/paginar'
import type {
  Alerta,
  CentroCosto,
  FilaAsignacion,
  FilaEquipo,
  FilaLinea,
  Persona,
  PlanTelecom,
} from './tipos'

export type Respuesta<T> = { datos: T; error: string | null }

export async function leerLineas(): Promise<Respuesta<FilaLinea[]>> {
  const supabase = await createClient()
  const { datos, error } = await leerTodo<FilaLinea>((d, h) =>
    supabase.from('v_telecom_lineas').select('*').order('numero').range(d, h)
  )
  return { datos, error }
}

export async function leerEquipos(): Promise<Respuesta<FilaEquipo[]>> {
  const supabase = await createClient()
  const { datos, error } = await leerTodo<FilaEquipo>((d, h) =>
    supabase
      .from('v_telecom_equipos')
      .select('*')
      .order('fecha_renovacion', { ascending: true, nullsFirst: false })
      .order('imei')
      .range(d, h)
  )
  return { datos, error }
}

export async function leerAsignaciones(): Promise<Respuesta<FilaAsignacion[]>> {
  const supabase = await createClient()
  const { datos, error } = await leerTodo<FilaAsignacion>((d, h) =>
    supabase
      .from('v_telecom_asignaciones')
      .select('*')
      .order('fecha_entrega', { ascending: false })
      .order('id', { ascending: false })
      .range(d, h)
  )
  return { datos, error }
}

/**
 * Las alertas del tablero, de la más urgente a la menos.
 *
 * El orden lo pone la BASE por días restantes: lo vencido primero. Es lo
 * único que se mira al abrir la pantalla.
 */
export async function leerAlertas(): Promise<Respuesta<Alerta[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_telecom_alertas')
    .select('*')
    .order('dias', { ascending: true })
  return { datos: (data as Alerta[] | null) ?? [], error: error?.message ?? null }
}

export async function leerCatalogos(): Promise<{
  planes: PlanTelecom[]
  personal: Persona[]
  centrosCosto: CentroCosto[]
  departamentos: { id: string; nombre: string }[]
  puestos: string[]
  error: string | null
}> {
  const supabase = await createClient()
  const [
    { data: planes, error: e1 },
    { data: personal, error: e2 },
    { data: centros },
    { data: departamentos },
    { data: puestos },
  ] = await Promise.all([
    supabase.from('telecom_planes').select('*').eq('activo', true).order('nombre'),
    // Sólo quien puede recibir un teléfono. Un catálogo de seiscientos
    // operadores de maquinaria en el selector de entrega no ayuda a
    // encontrar a la contadora.
    supabase
      .from('catalogo_personal')
      .select('id, codigo, nombre, es_operador, es_administrativo, activo')
      .eq('activo', true)
      .order('nombre'),
    // Llegan con la migración 48. Sin ella el selector sale vacío y el
    // campo se sigue pudiendo llenar dando de alta desde el propio
    // selector, que es lo que hace que no bloquee una entrega.
    supabase.from('telecom_centros_costo').select('*').eq('activo', true).order('codigo'),
    supabase.from('departamentos').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('telecom_puestos').select('nombre').eq('activo', true).order('nombre'),
  ])

  return {
    planes: (planes as PlanTelecom[] | null) ?? [],
    personal: (personal as Persona[] | null) ?? [],
    centrosCosto: (centros as CentroCosto[] | null) ?? [],
    departamentos: (departamentos as { id: string; nombre: string }[] | null) ?? [],
    puestos: ((puestos as { nombre: string }[] | null) ?? []).map((p) => p.nombre),
    error: e1?.message ?? e2?.message ?? null,
  }
}
