'use client'

/**
 * Persistencia del módulo de desinfección desde el navegador.
 *
 * Sólo lee y escribe: no valida —eso es `calculo.ts`— y no decide quién
 * puede hacer qué —eso es RLS, y su reflejo en pantalla es
 * `canExecuteAction`—.
 *
 * **Guardar una ejecución no es una sola sentencia, y conviene saberlo.**
 * La migración 59 no dejó una función que guarde cabecera y detalle de un
 * golpe, así que aquí van tres pasos encadenados. El orden no es casual:
 * primero la cabecera, después se AÑADE o se corrige lo que cuelga, y
 * sólo al final se borra lo que sobró. Si algo revienta a mitad, lo peor
 * que queda es un renglón de más —visible, corregible— y nunca un dato
 * capturado que desapareció.
 */

import { createClient } from '@/lib/supabase/client'
import { leerTodo } from '@/lib/supabase/paginar'
import { mensajeDeError } from '@/lib/errores'
import { aNumero, aNumeroCero, idsSobrantes, lecturasParaGuardar } from './calculo'
import type {
  CatalogosDesinfeccion,
  EntradaEjecucion,
  EntradaLogistica,
  EntradaPlan,
  FilaCosto,
  FilaEjecucion,
  FilaLogistica,
  FilaLoteRegado,
  FilaPersonal,
  FilaPlan,
  LecturaTensiometro,
  LineaLote,
  LineaPersonal,
} from './tipos'

export type Resultado = { ok: boolean; mensaje: string }

export const AVISO_SIN_MIGRACION =
  'El módulo de desinfección de suelo todavía no está instalado. Corre la migración 59 en el SQL Editor de Supabase.'

export function faltaMigracion(mensaje: string | null | undefined): boolean {
  const t = (mensaje ?? '').toLowerCase()
  return t.includes('does not exist') || t.includes('schema cache')
}

/** Lo que devuelve una lectura: los datos, y por qué no hay si no los hay. */
export type Lectura<T> = { datos: T[]; error: string | null }

/* ================================================================== */
/* PLAN                                                                */
/* ================================================================== */

export async function leerPlan(temporadaId: string | null): Promise<Lectura<FilaPlan>> {
  return leerTodo<FilaPlan>((desde, hasta) => {
    let q = createClient()
      .from('v_desinfeccion_plan')
      .select('*')
      .order('fecha_aplicacion', { ascending: true })
      .order('lote_nomenclatura', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta)
    if (temporadaId) q = q.eq('temporada_id', temporadaId)
    return q
  })
}

/** Qué columna de la tabla hay detrás de cada columna de la cuadrícula. */
const CAMPOS_PLAN: Record<string, string> = {
  lote_nomenclatura: 'lote_temporada_id',
  ciclo: 'ciclo',
  fecha_siembra_congelada: 'fecha_siembra_congelada',
  dias_aplicacion: 'dias_aplicacion',
  variedad_nombre: 'variedad_id',
  producto_nombre: 'producto_id',
  dosis_mz: 'dosis_mz',
  area_planificada_mz: 'area_planificada_mz',
  costo_litro: 'costo_litro',
  comentarios: 'comentarios',
}

const NUMERICOS_PLAN = new Set([
  'ciclo',
  'dias_aplicacion',
  'dosis_mz',
  'area_planificada_mz',
  'costo_litro',
])

export function campoPlan(columna: string): string | null {
  return CAMPOS_PLAN[columna] ?? null
}

export async function editarCampoPlan(
  id: string,
  columna: string,
  valor: unknown
): Promise<Resultado> {
  const campo = campoPlan(columna)
  if (!campo) return { ok: false, mensaje: 'Esa columna no se edita.' }

  const texto = valor === null || valor === undefined ? '' : String(valor)
  const dato = NUMERICOS_PLAN.has(campo)
    ? (aNumero(texto) ?? 0)
    : texto.trim() === ''
      ? null
      : texto.trim()

  const { error } = await createClient()
    .from('desinfeccion_plan')
    .update({ [campo]: dato })
    .eq('id', id)

  if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo guardar el cambio.') }
  return { ok: true, mensaje: '' }
}

export async function guardarPlan(e: EntradaPlan): Promise<Resultado> {
  const fila = {
    temporada_id: e.temporadaId,
    lote_temporada_id: e.loteTemporadaId,
    ciclo: Math.trunc(aNumeroCero(e.ciclo)) || 1,
    fecha_siembra_congelada: e.fechaSiembraCongelada,
    dias_aplicacion: Math.trunc(aNumeroCero(e.diasAplicacion)),
    variedad_id: e.variedadId || null,
    producto_id: e.productoId || null,
    dosis_mz: aNumeroCero(e.dosisMz),
    area_planificada_mz: aNumeroCero(e.areaPlanificadaMz),
    costo_litro: aNumeroCero(e.costoLitro),
    comentarios: e.comentarios.trim() || null,
  }

  const cliente = createClient()
  const { error } = e.id
    ? await cliente.from('desinfeccion_plan').update(fila).eq('id', e.id)
    : await cliente.from('desinfeccion_plan').insert(fila)

  if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo guardar el plan.') }
  return { ok: true, mensaje: e.id ? 'Plan guardado.' : 'Plan creado.' }
}

export async function eliminarPlanes(ids: string[]): Promise<Resultado> {
  if (ids.length === 0) return { ok: true, mensaje: '' }
  const { error } = await createClient().from('desinfeccion_plan').delete().in('id', ids)
  if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo eliminar.') }
  return { ok: true, mensaje: `${ids.length} línea(s) de plan eliminadas.` }
}

/**
 * Vuelve a copiar la fecha de siembra REAL sobre el plan.
 *
 * La `fecha_siembra_congelada` se copia a propósito al planificar (ver la
 * migración 59): si la siembra se mueve, el plan no se mueve solo, porque
 * ya se compró el producto y ya se cuadró la cuadrilla. Pero a veces la
 * siembra se movió de verdad y hay que re-planificar — y eso es una
 * DECISIÓN, no un automatismo. Este botón es esa decisión, tomada a mano
 * sobre las líneas que se eligen.
 *
 * La siembra real sale de `siembras`, que es la captura de trasplante. Si
 * quien está mirando no tiene permiso sobre ese módulo, la consulta
 * devuelve menos filas y se dice cuántas no se pudieron resolver: lo que
 * no puede pasar es que el botón diga «listo» sin haber cambiado nada.
 */
export async function sincronizarSiembra(
  filas: { id: string; lote_temporada_id: string; ciclo: number; fecha_siembra_congelada: string }[]
): Promise<Resultado & { cambiadas: number; sinSiembra: number }> {
  if (filas.length === 0) {
    return { ok: true, mensaje: '', cambiadas: 0, sinSiembra: 0 }
  }

  const cliente = createClient()
  const lotes = [...new Set(filas.map((f) => f.lote_temporada_id))]
  const { data, error } = await cliente
    .from('siembras')
    .select('lote_temporada_id, ciclo, fecha_siembra')
    .in('lote_temporada_id', lotes)

  if (error) {
    return {
      ok: false,
      mensaje: mensajeDeError(error, 'No se pudo consultar la siembra real.'),
      cambiadas: 0,
      sinSiembra: 0,
    }
  }

  // La primera siembra del lote en ese ciclo: un lote se siembra en varios
  // días y la que manda para contar los días a la aplicación es la que
  // abrió el ciclo.
  const primera = new Map<string, string>()
  for (const s of (data ?? []) as { lote_temporada_id: string; ciclo: number; fecha_siembra: string }[]) {
    const llave = `${s.lote_temporada_id}|${s.ciclo}`
    const actual = primera.get(llave)
    if (!actual || s.fecha_siembra < actual) primera.set(llave, s.fecha_siembra)
  }

  let cambiadas = 0
  let sinSiembra = 0
  for (const f of filas) {
    const real = primera.get(`${f.lote_temporada_id}|${f.ciclo}`)
    if (!real) {
      sinSiembra++
      continue
    }
    if (real === f.fecha_siembra_congelada) continue

    const { error: e } = await cliente
      .from('desinfeccion_plan')
      .update({ fecha_siembra_congelada: real })
      .eq('id', f.id)
    if (e) {
      return {
        ok: false,
        mensaje: mensajeDeError(e, 'No se pudo actualizar la fecha de siembra.'),
        cambiadas,
        sinSiembra,
      }
    }
    cambiadas++
  }

  const partes = [`${cambiadas} línea(s) actualizadas`]
  if (sinSiembra > 0) {
    partes.push(
      `${sinSiembra} sin siembra registrada (o fuera de lo que puedes ver en Trasplante)`
    )
  }
  return { ok: true, mensaje: `${partes.join('; ')}.`, cambiadas, sinSiembra }
}

/* ================================================================== */
/* EJECUCIÓN                                                           */
/* ================================================================== */

export async function leerEjecuciones(temporadaId: string | null): Promise<Lectura<FilaEjecucion>> {
  return leerTodo<FilaEjecucion>((desde, hasta) => {
    let q = createClient()
      .from('v_desinfeccion_ejecucion')
      .select('*')
      .order('fecha_aplicacion', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(desde, hasta)
    if (temporadaId) q = q.eq('temporada_id', temporadaId)
    return q
  })
}

export async function leerLotesRegados(temporadaId: string | null): Promise<Lectura<FilaLoteRegado>> {
  return leerTodo<FilaLoteRegado>((desde, hasta) => {
    let q = createClient()
      .from('v_desinfeccion_lotes')
      .select('*')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta)
    if (temporadaId) q = q.eq('temporada_id', temporadaId)
    return q
  })
}

export async function leerPersonal(temporadaId: string | null): Promise<Lectura<FilaPersonal>> {
  return leerTodo<FilaPersonal>((desde, hasta) => {
    let q = createClient()
      .from('v_desinfeccion_personal')
      .select('*')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta)
    if (temporadaId) q = q.eq('temporada_id', temporadaId)
    return q
  })
}

/**
 * Lo que cuelga de UNA ejecución, para abrir el formulario.
 *
 * Se pide por ejecución y no se reutiliza lo que ya está en pantalla
 * porque la cuadrícula sólo trae el resumen —manzanas y costo sumados—,
 * y el formulario necesita renglón por renglón.
 */
export async function leerDetalle(
  ejecucionId: string
): Promise<{ lotes: FilaLoteRegado[]; personal: FilaPersonal[]; error: string | null }> {
  const cliente = createClient()
  const [l, p] = await Promise.all([
    cliente
      .from('v_desinfeccion_lotes')
      .select('*')
      .eq('ejecucion_id', ejecucionId)
      .order('created_at', { ascending: true }),
    cliente
      .from('v_desinfeccion_personal')
      .select('*')
      .eq('ejecucion_id', ejecucionId)
      .order('created_at', { ascending: true }),
  ])

  const error = l.error?.message ?? p.error?.message ?? null
  return {
    lotes: (l.data as FilaLoteRegado[] | null) ?? [],
    personal: (p.data as FilaPersonal[] | null) ?? [],
    error,
  }
}

function filaEjecucion(e: EntradaEjecucion, lecturas: LecturaTensiometro[]) {
  return {
    temporada_id: e.temporadaId,
    turno_id: e.turnoId,
    estado: e.estado,

    fecha_preriego: e.fechaPreriego || null,
    hora_inicio_preriego: e.horaInicioPreriego || null,
    hora_fin_preriego: e.horaFinPreriego || null,
    obs_preriego: e.obsPreriego.trim() || null,

    lecturas_tensiometro: lecturasParaGuardar(lecturas),

    fecha_aplicacion: e.fechaAplicacion || null,
    estacion_riego_id: e.estacionRiegoId || null,
    horas_presurizacion: aNumeroCero(e.horasPresurizacion),
    hora_inicio_iny: e.horaInicioIny || null,
    hora_fin_iny: e.horaFinIny || null,
    horas_lavado: aNumeroCero(e.horasLavado),
    total_horas_riego: aNumeroCero(e.totalHorasRiego),
    ppm: aNumero(e.ppm),
    ce_antes: aNumero(e.ceAntes),
    ce_durante: aNumero(e.ceDurante),
    ce_despues: aNumero(e.ceDespues),
    calibracion_entrada: aNumero(e.calibracionEntrada),
    calibracion_salida: aNumero(e.calibracionSalida),
    calibracion_campo: aNumero(e.calibracionCampo),

    producto_id: e.productoId || null,
    litros_acido: aNumeroCero(e.litrosAcido),
    costo_litro_acido: aNumeroCero(e.costoLitroAcido),
  }
}

/**
 * Guarda la ejecución entera: cabecera, lotes regados y cuadrilla.
 *
 * Tres pasos, en este orden y no en otro:
 *
 *   1. La cabecera. Sin ella no hay de qué colgar lo demás.
 *   2. Lo que cuelga: se corrige lo que ya estaba y se añade lo nuevo.
 *   3. Y AL FINAL se borra lo que se quitó.
 *
 * Borrar primero sería más corto de escribir y mucho peor: una
 * desconexión a mitad dejaría el turno sin los lotes que sí tenía. Así,
 * lo peor que puede quedar es un renglón de más, que se ve y se corrige.
 */
export async function guardarEjecucion(
  e: EntradaEjecucion,
  lecturas: LecturaTensiometro[],
  lotes: LineaLote[],
  personal: LineaPersonal[]
): Promise<Resultado> {
  const cliente = createClient()
  const fila = filaEjecucion(e, lecturas)

  let ejecucionId = e.id
  if (ejecucionId) {
    const { error } = await cliente.from('desinfeccion_ejecucion').update(fila).eq('id', ejecucionId)
    if (error) {
      return { ok: false, mensaje: mensajeDeError(error, 'No se pudo guardar la ejecución.') }
    }
  } else {
    const { data, error } = await cliente
      .from('desinfeccion_ejecucion')
      .insert(fila)
      .select('id')
      .single()
    if (error || !data) {
      return { ok: false, mensaje: mensajeDeError(error, 'No se pudo crear la ejecución.') }
    }
    ejecucionId = (data as { id: string }).id
  }

  // Los identificadores que quedan VIVOS después de guardar: los que ya
  // existían más los que se acaban de crear. Hay que quedarse con los
  // nuevos sí o sí — comparar el borrado contra los identificadores del
  // formulario borraría justo lo que se acaba de insertar, porque un
  // renglón nuevo todavía no tiene identificador.
  const vivosLotes: string[] = []
  const vivosPersonal: string[] = []

  /* ----------------------------- Lotes ----------------------------- */
  const lotesValidos = lotes.filter((l) => l.loteTemporadaId !== '')
  for (const l of lotesValidos) {
    const datos = {
      ejecucion_id: ejecucionId,
      lote_temporada_id: l.loteTemporadaId,
      mz_cubiertas: aNumeroCero(l.mzCubiertas),
    }
    if (l.id) {
      const { error } = await cliente
        .from('desinfeccion_ejecucion_lotes')
        .update(datos)
        .eq('id', l.id)
      if (error) {
        return {
          ok: false,
          mensaje: mensajeDeError(error, 'La ejecución se guardó, pero un lote regado no.'),
        }
      }
      vivosLotes.push(l.id)
    } else {
      const { data, error } = await cliente
        .from('desinfeccion_ejecucion_lotes')
        .insert(datos)
        .select('id')
        .single()
      if (error || !data) {
        return {
          ok: false,
          mensaje: mensajeDeError(error, 'La ejecución se guardó, pero un lote regado no.'),
        }
      }
      vivosLotes.push((data as { id: string }).id)
    }
  }

  /* ---------------------------- Personal --------------------------- */
  const personalValido = personal.filter((p) => p.puestoId !== '')
  for (const p of personalValido) {
    const datos = {
      ejecucion_id: ejecucionId,
      puesto_id: p.puestoId,
      operador_id: p.operadorId || null,
      cantidad_personas: Math.trunc(aNumeroCero(p.cantidadPersonas)) || 1,
      jornadas: aNumeroCero(p.jornadas),
      horas_extras: aNumeroCero(p.horasExtras),
      jornada_tipo: p.jornadaTipo,
    }
    if (p.id) {
      const { error } = await cliente.from('desinfeccion_personal').update(datos).eq('id', p.id)
      if (error) {
        return {
          ok: false,
          mensaje: mensajeDeError(error, 'La ejecución se guardó, pero un renglón de personal no.'),
        }
      }
      vivosPersonal.push(p.id)
    } else {
      const { data, error } = await cliente
        .from('desinfeccion_personal')
        .insert(datos)
        .select('id')
        .single()
      if (error || !data) {
        return {
          ok: false,
          mensaje: mensajeDeError(error, 'La ejecución se guardó, pero un renglón de personal no.'),
        }
      }
      vivosPersonal.push((data as { id: string }).id)
    }
  }

  /* --------------------- Y al final, lo que sobró ------------------- */
  const borrado = await borrarSobrantes(ejecucionId, vivosLotes, vivosPersonal)
  if (!borrado.ok) return borrado

  return { ok: true, mensaje: e.id ? 'Ejecución guardada.' : 'Ejecución creada.' }
}

/**
 * Quita de la base los renglones que ya no están.
 *
 * Recibe los identificadores VIVOS —no las líneas del formulario— por el
 * fallo que explica `idsSobrantes`: un renglón recién insertado no tiene
 * identificador en el formulario, y compararlo contra él lo borraría
 * inmediatamente después de crearlo.
 */
async function borrarSobrantes(
  ejecucionId: string,
  vivosLotes: string[],
  vivosPersonal: string[]
): Promise<Resultado> {
  const cliente = createClient()
  const { lotes: antes, personal: antesP, error } = await leerDetalle(ejecucionId)
  if (error) {
    // Lo guardado ya está bien; lo único que no se pudo es limpiar.
    return { ok: false, mensaje: `Se guardó, pero no se pudo revisar lo anterior: ${error}` }
  }

  const sobranLotes = idsSobrantes(antes, vivosLotes)
  const sobranPersonal = idsSobrantes(antesP, vivosPersonal)

  if (sobranLotes.length > 0) {
    const { error: e } = await cliente
      .from('desinfeccion_ejecucion_lotes')
      .delete()
      .in('id', sobranLotes)
    if (e) return { ok: false, mensaje: mensajeDeError(e, 'No se pudo quitar un lote.') }
  }
  if (sobranPersonal.length > 0) {
    const { error: e } = await cliente.from('desinfeccion_personal').delete().in('id', sobranPersonal)
    if (e) return { ok: false, mensaje: mensajeDeError(e, 'No se pudo quitar un renglón de personal.') }
  }
  return { ok: true, mensaje: '' }
}

/**
 * Qué columna de la tabla hay detrás de cada columna de la cuadrícula.
 *
 * Sólo están las que se corrigen de pasada. Lo demás —lecturas, lotes
 * regados, cuadrilla— se edita en el formulario: una celda no puede
 * guardar una lista.
 */
const CAMPOS_EJECUCION: Record<string, string> = {
  estado: 'estado',
  fecha_preriego: 'fecha_preriego',
  fecha_aplicacion: 'fecha_aplicacion',
  estacion_riego_nombre: 'estacion_riego_id',
  horas_presurizacion: 'horas_presurizacion',
  horas_lavado: 'horas_lavado',
  total_horas_riego: 'total_horas_riego',
  ppm: 'ppm',
  ce_antes: 'ce_antes',
  ce_durante: 'ce_durante',
  ce_despues: 'ce_despues',
  producto_nombre: 'producto_id',
  litros_acido: 'litros_acido',
  costo_litro_acido: 'costo_litro_acido',
  obs_preriego: 'obs_preriego',
}

const NUMERICOS_EJECUCION = new Set([
  'horas_presurizacion',
  'horas_lavado',
  'total_horas_riego',
  'ppm',
  'ce_antes',
  'ce_durante',
  'ce_despues',
  'litros_acido',
  'costo_litro_acido',
])

export function campoEjecucion(columna: string): string | null {
  return CAMPOS_EJECUCION[columna] ?? null
}

export async function editarCampoEjecucion(
  id: string,
  columna: string,
  valor: unknown
): Promise<Resultado> {
  const campo = campoEjecucion(columna)
  if (!campo) return { ok: false, mensaje: 'Esa columna no se edita.' }

  const texto = valor === null || valor === undefined ? '' : String(valor)
  const dato = NUMERICOS_EJECUCION.has(campo)
    ? aNumero(texto)
    : texto.trim() === ''
      ? null
      : texto.trim()

  const { error } = await createClient()
    .from('desinfeccion_ejecucion')
    .update({ [campo]: dato })
    .eq('id', id)

  if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo guardar el cambio.') }
  return { ok: true, mensaje: '' }
}

export async function cambiarFase(ids: string[], estado: string): Promise<Resultado> {
  if (ids.length === 0) return { ok: true, mensaje: '' }
  const { error } = await createClient()
    .from('desinfeccion_ejecucion')
    .update({ estado })
    .in('id', ids)
  if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo cambiar la fase.') }
  return { ok: true, mensaje: `${ids.length} ejecución(es) actualizadas.` }
}

export async function eliminarEjecuciones(ids: string[]): Promise<Resultado> {
  if (ids.length === 0) return { ok: true, mensaje: '' }
  const { error } = await createClient().from('desinfeccion_ejecucion').delete().in('id', ids)
  if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo eliminar.') }
  return { ok: true, mensaje: `${ids.length} ejecución(es) eliminadas.` }
}

/* ================================================================== */
/* LOGÍSTICA                                                           */
/* ================================================================== */

export async function leerLogistica(temporadaId: string | null): Promise<Lectura<FilaLogistica>> {
  return leerTodo<FilaLogistica>((desde, hasta) => {
    let q = createClient()
      .from('v_desinfeccion_logistica')
      .select('*')
      .order('fecha', { ascending: false })
      .order('id', { ascending: true })
      .range(desde, hasta)
    if (temporadaId) q = q.eq('temporada_id', temporadaId)
    return q
  })
}

const CAMPOS_LOGISTICA: Record<string, string> = {
  fecha: 'fecha',
  zona_nombre: 'zona_id',
  equipo_nombre: 'equipo_id',
  implemento_nombre: 'implemento_id',
  operador_nombre: 'operador_id',
  horas_trabajo: 'horas_trabajo',
  costo_hora: 'costo_hora',
  comentarios: 'comentarios',
}

const NUMERICOS_LOGISTICA = new Set(['horas_trabajo', 'costo_hora'])

export function campoLogistica(columna: string): string | null {
  return CAMPOS_LOGISTICA[columna] ?? null
}

export async function editarCampoLogistica(
  id: string,
  columna: string,
  valor: unknown
): Promise<Resultado> {
  const campo = campoLogistica(columna)
  if (!campo) return { ok: false, mensaje: 'Esa columna no se edita.' }

  const texto = valor === null || valor === undefined ? '' : String(valor)
  const dato = NUMERICOS_LOGISTICA.has(campo)
    ? aNumero(texto)
    : texto.trim() === ''
      ? null
      : texto.trim()

  const { error } = await createClient()
    .from('desinfeccion_logistica')
    .update({ [campo]: dato })
    .eq('id', id)

  if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo guardar el cambio.') }
  return { ok: true, mensaje: '' }
}

export async function guardarLogistica(e: EntradaLogistica): Promise<Resultado> {
  const fila = {
    temporada_id: e.temporadaId,
    zona_id: e.zonaId,
    fecha: e.fecha,
    equipo_id: e.equipoId,
    implemento_id: e.implementoId || null,
    operador_id: e.operadorId || null,
    horas_trabajo: aNumeroCero(e.horasTrabajo),
    // Vacío = que lo ponga el disparador desde `tarifas_equipo`. Mandar
    // cero sería decirle «este acarreo no costó nada», que es distinto.
    costo_hora: aNumero(e.costoHora),
    comentarios: e.comentarios.trim() || null,
  }

  const cliente = createClient()
  const { error } = e.id
    ? await cliente.from('desinfeccion_logistica').update(fila).eq('id', e.id)
    : await cliente.from('desinfeccion_logistica').insert(fila)

  if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo guardar el acarreo.') }
  return { ok: true, mensaje: e.id ? 'Acarreo guardado.' : 'Acarreo registrado.' }
}

export async function eliminarLogistica(ids: string[]): Promise<Resultado> {
  if (ids.length === 0) return { ok: true, mensaje: '' }
  const { error } = await createClient().from('desinfeccion_logistica').delete().in('id', ids)
  if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo eliminar.') }
  return { ok: true, mensaje: `${ids.length} acarreo(s) eliminados.` }
}

/* ================================================================== */
/* COSTOS                                                              */
/* ================================================================== */

/**
 * El costo por lote, ya prorrateado por la vista.
 *
 * La vista no tiene columna `id` —su llave es el lote— y la cuadrícula
 * necesita una, así que se le pega aquí. Es la única fila por lote, así
 * que no hay forma de que dos compartan identificador.
 */
export async function leerCostos(
  temporadaId: string | null
): Promise<Lectura<FilaCosto & { id: string }>> {
  const { datos, error } = await leerTodo<FilaCosto>((desde, hasta) => {
    let q = createClient()
      .from('v_desinfeccion_costos')
      .select('*')
      .order('lote_nomenclatura', { ascending: true })
      .order('lote_temporada_id', { ascending: true })
      .range(desde, hasta)
    if (temporadaId) q = q.eq('temporada_id', temporadaId)
    return q
  })
  return { datos: datos.map((d) => ({ ...d, id: d.lote_temporada_id })), error }
}

/* ================================================================== */
/* TARIFAS                                                             */
/* ================================================================== */

/**
 * La tarifa de la JORNADA de un puesto en una fecha.
 *
 * Va por `fn_tarifa_puesto` y no por un `select` a `tarifas_puesto`
 * porque esa tabla se lee con el permiso de Costos o de Tarifas, y quien
 * captura en campo no suele tenerlo. La función es `security definer` y
 * está concedida a `authenticated` justamente para esto: para que la
 * vista previa del costo salga sin abrirle la tabla de salarios a nadie.
 */
export async function tarifaPuesto(puestoId: string, fecha: string): Promise<number | null> {
  if (!puestoId || !fecha) return null
  const { data, error } = await createClient().rpc('fn_tarifa_puesto', {
    p_puesto_id: puestoId,
    p_fecha: fecha,
  })
  if (error) return null
  const n = Number(data)
  return Number.isFinite(n) ? n : null
}

/* ================================================================== */
/* CATÁLOGO DE LOTES                                                   */
/* ================================================================== */

/**
 * Los lotes de una temporada, con su zona.
 *
 * Se piden desde el navegador y no desde la página porque dependen de la
 * temporada que se esté mirando, y ésa se cambia sin recargar.
 */
export async function leerLotes(temporadaId: string): Promise<CatalogosDesinfeccion['lotes']> {
  if (!temporadaId) return []
  const { data } = await createClient()
    .from('lotes_temporada')
    .select('id, zona_id, area_neta, lotes(nomenclatura, nombre)')
    .eq('temporada_id', temporadaId)
    .eq('activo', true)
    .order('id')

  type Cruda = {
    id: string
    zona_id: string | null
    area_neta: number | null
    lotes: { nomenclatura: string; nombre: string | null } | { nomenclatura: string; nombre: string | null }[] | null
  }

  return ((data as Cruda[] | null) ?? [])
    .map((d) => {
      const lote = Array.isArray(d.lotes) ? d.lotes[0] : d.lotes
      return {
        lote_temporada_id: d.id,
        nomenclatura: lote?.nomenclatura ?? '—',
        nombre: lote?.nombre ?? null,
        zona_id: d.zona_id,
        area_neta: Number(d.area_neta ?? 0),
      }
    })
    .sort((a, b) => a.nomenclatura.localeCompare(b.nomenclatura, 'es', { numeric: true }))
}
