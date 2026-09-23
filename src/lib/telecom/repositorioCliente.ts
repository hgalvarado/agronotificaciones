'use client'

/**
 * Escrituras de telecomunicaciones desde el navegador.
 *
 * El único sitio del módulo que escribe. No valida ni decide: recibe
 * valores ya limpios y los manda. Está separado de `repositorio.ts`
 * —que lee en el servidor— porque usan clientes distintos y en Next un
 * archivo no puede ser las dos cosas.
 *
 * Las dos acciones rápidas pasan por funciones de la base y no por un
 * `update` suelto: finalizar una asignación también libera la línea y el
 * equipo, y «pasar a Plan $1» tiene que encontrar el plan por su
 * bandera. Las dos cosas son de la base, no de la pantalla.
 */

import { createClient } from '@/lib/supabase/client'
import type { Persona, PlanTelecom, Solicitud, TramoHistorial } from './tipos'

type Resultado = { error: string | null }

const err = (e: { message: string } | null): Resultado => ({ error: e?.message ?? null })

/* ------------------------------- Líneas ------------------------------ */

export type CamposLinea = {
  proveedor?: string | null
  plan_id?: string | null
  estado?: string
  observaciones?: string | null
  activo?: boolean
}

export async function guardarLinea(numero: string, campos: CamposLinea): Promise<Resultado> {
  const { error } = await createClient().from('telecom_lineas').update(campos).eq('numero', numero)
  return err(error)
}

export async function crearLinea(fila: {
  numero: string
  proveedor: string | null
  plan_id: string | null
  observaciones: string | null
}): Promise<Resultado> {
  const { error } = await createClient().from('telecom_lineas').insert(fila)
  return err(error)
}

export async function borrarLineas(numeros: string[]): Promise<Resultado> {
  if (numeros.length === 0) return { error: null }
  const { error } = await createClient().from('telecom_lineas').delete().in('numero', numeros)
  return err(error)
}

/** «Pasar a Plan $1»: conserva el número sin pagar el plan completo. */
export async function pasarARetencion(numero: string): Promise<Resultado> {
  const { error } = await createClient().rpc('fn_telecom_pasar_a_retencion', { p_numero: numero })
  return err(error)
}

/* ------------------------------- Equipos ----------------------------- */

export type CamposEquipo = {
  marca_modelo?: string
  ram?: string | null
  almacenamiento?: string | null
  fecha_compra?: string | null
  estado?: string
  observaciones?: string | null
  activo?: boolean
}

export async function guardarEquipo(imei: string, campos: CamposEquipo): Promise<Resultado> {
  const { error } = await createClient().from('telecom_equipos').update(campos).eq('imei', imei)
  return err(error)
}

export async function crearEquipo(fila: {
  imei: string
  marca_modelo: string
  ram: string | null
  almacenamiento: string | null
  fecha_compra: string | null
  observaciones: string | null
}): Promise<Resultado> {
  const { error } = await createClient().from('telecom_equipos').insert(fila)
  return err(error)
}

export async function borrarEquipos(imeis: string[]): Promise<Resultado> {
  if (imeis.length === 0) return { error: null }
  const { error } = await createClient().from('telecom_equipos').delete().in('imei', imeis)
  return err(error)
}

/* ----------------------------- Asignaciones -------------------------- */

export type AsignacionNueva = {
  empleado_id: string
  linea_numero: string | null
  equipo_imei: string | null
  fecha_entrega: string
  fecha_devolucion_programada: string | null
  centro_costo: string | null
  departamento: string | null
  puesto: string | null
  correo_asignado: string | null
  accesorios_entregados: string[]
  observaciones: string | null
}

/**
 * Entrega una línea, un equipo o los dos.
 *
 * `usuario_id` no viaja en el formulario: quien entrega es quien firma, y
 * eso lo sabe la sesión, no la pantalla.
 */
export async function crearAsignacion(fila: AsignacionNueva): Promise<Resultado> {
  const supabase = createClient()
  const { data: sesion } = await supabase.auth.getUser()
  const usuarioId = sesion.user?.id
  if (!usuarioId) return { error: 'La sesión expiró. Vuelve a entrar para registrar la entrega.' }

  const { error } = await supabase
    .from('telecom_asignaciones')
    .insert({ ...fila, usuario_id: usuarioId })
  return err(error)
}

export type CamposAsignacion = {
  /**
   * Entre Vigente y Revisar. FINALIZADA no se pone por aquí: cierra la
   * entrega y libera la línea, y eso lo hace `finalizarAsignacion` para
   * que la fecha real de devolución no quede vacía.
   */
  estado?: string
  fecha_devolucion_programada?: string | null
  centro_costo?: string | null
  departamento?: string | null
  puesto?: string | null
  correo_asignado?: string | null
  accesorios_entregados?: string[]
  observaciones?: string | null
}

export async function guardarAsignacion(
  id: string,
  campos: CamposAsignacion
): Promise<Resultado> {
  const { error } = await createClient().from('telecom_asignaciones').update(campos).eq('id', id)
  return err(error)
}

/** Cierra la asignación: pone la fecha real y libera línea y equipo. */
export async function finalizarAsignacion(id: string, fecha: string | null): Promise<Resultado> {
  const { error } = await createClient().rpc('fn_telecom_finalizar_asignacion', {
    p_id: id,
    p_fecha: fecha,
  })
  return err(error)
}

export async function borrarAsignaciones(ids: string[]): Promise<Resultado> {
  if (ids.length === 0) return { error: null }
  const { error } = await createClient().from('telecom_asignaciones').delete().in('id', ids)
  return err(error)
}

/* --------------------------- Altas en línea -------------------------- */
/*
 * Lo que los selectores dan de alta sin salir del formulario. Devuelven
 * la fila creada porque quien la pidió la necesita para dejarla elegida:
 * volver a consultar el catálogo entero para encontrar lo que se acaba
 * de escribir es una vuelta al servidor que no hace falta.
 */

export async function crearPersona(
  nombre: string,
  codigo: string
): Promise<{ persona: Persona | null; error: string | null }> {
  const { data, error } = await createClient()
    .from('operadores')
    .insert({
      nombre: nombre.trim(),
      codigo: codigo.trim() || null,
      // Quien se da de alta desde aquí recibe un teléfono: nace
      // administrativo. Si además maneja maquinaria se le marca también
      // operador desde Catálogos → Personal.
      tipo_perfil: ['ADMINISTRATIVO'],
      activo: true,
    })
    .select('id, codigo, nombre')
    .single()

  if (error || !data) return { persona: null, error: error?.message ?? 'No se pudo crear.' }
  return {
    persona: {
      id: data.id as string,
      codigo: (data.codigo as string | null) ?? null,
      nombre: data.nombre as string,
      es_operador: false,
      es_administrativo: true,
      activo: true,
    },
    error: null,
  }
}

export async function crearPlan(
  nombre: string,
  costo: string
): Promise<{ plan: PlanTelecom | null; error: string | null }> {
  const { data, error } = await createClient()
    .from('telecom_planes')
    .insert({
      nombre: nombre.trim(),
      costo_mensual: costo.trim() ? Number(costo.replace(',', '.')) : null,
      activo: true,
    })
    .select('id, nombre, proveedor, costo_mensual, es_retencion, activo')
    .single()

  if (error || !data) return { plan: null, error: error?.message ?? 'No se pudo crear.' }
  return { plan: data as unknown as PlanTelecom, error: null }
}

export async function crearCentroCosto(codigo: string, nombre: string): Promise<Resultado> {
  const { error } = await createClient()
    .from('telecom_centros_costo')
    .insert({ codigo: codigo.trim(), nombre: nombre.trim() || null })
  return err(error)
}

export async function crearPuesto(nombre: string): Promise<Resultado> {
  const { error } = await createClient().from('telecom_puestos').insert({ nombre: nombre.trim() })
  return err(error)
}

export async function crearDepartamento(nombre: string): Promise<Resultado> {
  const { error } = await createClient().from('departamentos').insert({ nombre: nombre.trim() })
  return err(error)
}

/* ------------------------------ Historial ---------------------------- */

export async function leerHistorial(
  tipo: 'LINEA' | 'EQUIPO',
  llave: string
): Promise<{ datos: TramoHistorial[]; error: string | null }> {
  const { data, error } = await createClient().rpc('fn_telecom_historial', {
    p_tipo: tipo,
    p_llave: llave,
  })
  return { datos: (data as TramoHistorial[] | null) ?? [], error: error?.message ?? null }
}

/* ------------------------------ Bitácora ----------------------------- */

/**
 * Registra lo que se le pidió al proveedor.
 *
 * El responsable NO viaja: lo pone la base desde la sesión. Dejar que el
 * formulario diga quién lo pidió vacía de sentido la bitácora el día que
 * hay que reclamar.
 */
export async function registrarSolicitud(entrada: {
  numero: string
  accion: string
  detalle: string
  comentarios: string
  fecha: string | null
}): Promise<Resultado> {
  const { error } = await createClient().rpc('fn_telecom_registrar_solicitud', {
    p_linea_numero: entrada.numero,
    p_accion: entrada.accion,
    p_detalle: entrada.detalle.trim() || null,
    p_comentarios: entrada.comentarios.trim() || null,
    p_fecha: entrada.fecha || null,
  })
  return err(error)
}

export async function leerBitacora(
  numero: string
): Promise<{ datos: Solicitud[]; error: string | null }> {
  const { data, error } = await createClient().rpc('fn_telecom_bitacora', {
    p_linea_numero: numero,
  })
  return { datos: (data as Solicitud[] | null) ?? [], error: error?.message ?? null }
}
